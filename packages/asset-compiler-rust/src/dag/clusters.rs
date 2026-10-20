use super::*;
use trillion3d_math::scalar::normalized_bits;
use trillion3d_page_codec::clusters::{partition_triangles, wide_half};
use trillion3d_page_codec::partition::Fork;

/// The compiler's pool runs the two halves of a large bisection side by side (`partition.rs`):
/// each half writes only its own ranks, so the parts are the serial cut's.
pub(crate) struct Pool;
impl Fork for Pool {
    fn fork(&self, a: &mut (dyn FnMut() + Send), b: &mut (dyn FnMut() + Send)) {
        rayon::join(|| a(), || b());
    }
}

/// The clusters of `indices` over `positions`, parts of `max_triangles - 4` to `max_triangles`
/// triangles of the triangles' graph, by the one clusterer (`trillion3d_page_codec::clusters`):
/// the run-time cut's too. No vertex cap: a cluster over `DAG_CLUSTER_VERTICES` is halved at
/// encode (`constrain_wide`). Each cluster's triangles keep their source order.
pub fn cluster_triangles(
    positions: &[f32],
    indices: &[u32],
    max_triangles: usize,
) -> Result<Vec<Vec<u32>>> {
    if indices.is_empty() || !indices.len().is_multiple_of(3) {
        return Err(invalid("Index count must be a positive multiple of three"));
    }
    if max_triangles == 0 || !max_triangles.is_multiple_of(4) || max_triangles > 512 {
        return Err(invalid(
            "Cluster triangle budget must be a positive multiple of four up to 512",
        ));
    }
    let built = partition_triangles(positions, indices, max_triangles, &Pool);
    let mut start = 0;
    let clusters = built.ends.iter().map(|&end| {
        let cluster = built.indices[start..end].to_vec();
        start = end;
        cluster
    });
    Ok(clusters.collect())
}

/// The DAG's clusters held to the encoder's vertex cap, once every level is built: each cluster
/// over `DAG_CLUSTER_VERTICES` distinct vertices is cut after the first half of its triangles
/// (`wide_half`); the first half keeps its slot, the second takes a new one after every cluster,
/// with the same level, errors, spheres and links, listed among the children of the group that
/// replaces it and among the outputs of the group that made it. A half is never over the cap: 64
/// triangles name 192 vertices at most.
pub(super) fn constrain_wide(dag: &mut Vec<DagCluster>, groups: &mut [DagGroup]) {
    for slot in 0..dag.len() {
        let Some(cut) = wide_half(&dag[slot].indices, DAG_CLUSTER_VERTICES) else {
            continue;
        };
        let second = dag[slot].indices.split_off(cut);
        let half = DagCluster {
            indices: second,
            ..dag[slot].clone()
        };
        let id = dag.len();
        if let Some(group) = half.group {
            groups[group].children.push(id);
        }
        if let Some(group) = half.source {
            groups[group].outputs.push(id);
        }
        dag.push(half);
    }
}

// ---------------------------------------------------------------- cluster graph

/// Shared edges between clusters, an edge named by its two positions (`weld`, the canonical
/// vertex per position): an edge one cluster runs from `a` to `b` and another from `b` to `a` joins
/// them, whatever copies of its ends each draws — a texture seam, a hard edge, a flat-shaded leaf
/// cut between them, each triangle on its own copies. Per cluster, its neighbours in order, each
/// with the count of such pairs of edges; an edge whose two ends lie on one position is no edge.
pub fn cluster_adjacency(clusters: &[&[u32]], weld: &[u32]) -> Vec<Vec<(u32, u32)>> {
    // Every directed edge of every cluster, sorted whole by (edge, cluster): the records, hence
    // the counts, are the same whatever order the clusters were walked in.
    let mut records: Vec<(u64, u32)> = clusters
        .par_iter()
        .enumerate()
        .flat_map_iter(|(id, indices)| {
            indices.as_chunks::<3>().0.iter().flat_map(move |tri| {
                let tri = tri.map(|v| weld[v as usize]);
                (0..3).filter_map(move |k| {
                    let (a, b) = (tri[k], tri[(k + 1) % 3]);
                    (a != b).then_some((directed(a, b), id as u32))
                })
            })
        })
        .collect();
    records.par_sort_unstable();
    let run = |key: u64| {
        let start = records.partition_point(|r| r.0 < key);
        let end = records.partition_point(|r| r.0 <= key);
        &records[start..end]
    };
    let mut weights: Vec<WordMap<u32, u32>> = vec![WordMap::default(); clusters.len()];
    let mut start = 0usize;
    while start < records.len() {
        let key = records[start].0;
        let mut end = start + 1;
        while end < records.len() && records[end].0 == key {
            end += 1;
        }
        // Each pair of opposite edges once: from the run whose edge starts at the lower position.
        let (a, b) = ((key >> 32) as u32, key as u32);
        if a < b {
            for &(_, x) in &records[start..end] {
                for &(_, y) in run(directed(b, a)) {
                    if x != y {
                        *weights[x as usize].entry(y).or_insert(0) += 1;
                        *weights[y as usize].entry(x).or_insert(0) += 1;
                    }
                }
            }
        }
        start = end;
    }
    weights
        .into_iter()
        .map(|map| {
            let mut list: Vec<(u32, u32)> = map.into_iter().collect();
            list.sort_unstable();
            list
        })
        .collect()
}

/// The key of the edge from position `a` to position `b`.
fn directed(a: u32, b: u32) -> u64 {
    (u64::from(a) << 32) | u64::from(b)
}

pub(super) fn position_key(positions: &[f32], id: u32) -> [u32; 3] {
    let i = id as usize * 3;
    [
        normalized_bits(positions[i]),
        normalized_bits(positions[i + 1]),
        normalized_bits(positions[i + 2]),
    ]
}
/// Canonical vertex per position: duplicated vertices at UV or normal seams are one point, so a
/// lock placed on one copy locks every copy and no seam can crack.
pub fn weld_positions(positions: &[f32], indices: &[u32]) -> Vec<u32> {
    weld_by(positions.len() / 3, indices, |id| {
        position_key(positions, id)
    })
}
/// Canonical vertex per `key`: each vertex `indices` names takes the first in their order with its
/// key; one the list never names stays its own. The named vertices are sorted by key, then by
/// their first use, in parallel: each run of one key starts with its canonical vertex.
pub(super) fn weld_by<K: Ord + Send>(
    count: usize,
    indices: &[u32],
    key: impl Fn(u32) -> K + Sync,
) -> Vec<u32> {
    let mut first = vec![u32::MAX; count];
    for (rank, &id) in indices.iter().enumerate() {
        if let Some(slot) = first.get_mut(id as usize).filter(|r| **r == u32::MAX) {
            *slot = rank as u32;
        }
    }
    let mut named: Vec<(K, u32, u32)> = (0..count as u32)
        .into_par_iter()
        .filter(|&v| first[v as usize] != u32::MAX)
        .map(|v| (key(v), first[v as usize], v))
        .collect();
    named.par_sort_unstable_by(|x, y| (&x.0, x.1).cmp(&(&y.0, y.1)));
    let mut canonical: Vec<u32> = (0..count as u32).collect();
    let mut start = 0;
    while start < named.len() {
        let head = named[start].2;
        let mut end = start;
        while end < named.len() && named[end].0 == named[start].0 {
            canonical[named[end].2 as usize] = head;
            end += 1;
        }
        start = end;
    }
    canonical
}
/// Lock table for one level, per vertex: its position ends an external edge of its group — an
/// edge of the group's triangles that a triangle of another group of the level runs back, from
/// its second position to its first. Simplifying a group moves its external edges at a price
/// only (`qem_simplifier.rs`), so the cut keeps meeting its neighbours there. The primitive's own
/// open boundary, and a position two groups share only at a corner, stay free.
pub fn level_locks(weld: &[u32], clusters: &[&[u32]], groups: &[Vec<usize>]) -> Vec<bool> {
    // Every directed edge between two positions, with the group of the triangle running it.
    let mut edges: Vec<(u32, u32, u32)> = Vec::new();
    for (id, group) in groups.iter().enumerate() {
        for &slot in group {
            for tri in clusters[slot].as_chunks::<3>().0 {
                let corners = tri.map(|v| weld[v as usize]);
                for k in 0..3 {
                    let (a, b) = (corners[k], corners[(k + 1) % 3]);
                    if a != b {
                        edges.push((a, b, id as u32));
                    }
                }
            }
        }
    }
    edges.sort_unstable();
    edges.dedup();
    let mut locked_position = vec![false; weld.len()];
    for &(a, b, group) in &edges {
        let from = edges.partition_point(|e| (e.0, e.1) < (b, a));
        let back = edges[from..].iter().take_while(|e| (e.0, e.1) == (b, a));
        if back.into_iter().any(|e| e.2 != group) {
            locked_position[a as usize] = true;
            locked_position[b as usize] = true;
        }
    }
    (0..weld.len())
        .map(|vertex| locked_position[weld[vertex] as usize])
        .collect()
}
