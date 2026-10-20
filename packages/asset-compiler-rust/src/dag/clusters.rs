use super::*;
use trillion3d_page_codec::clusters::{partition_triangles, wide_half};
pub(super) use trillion3d_page_codec::edges::position_key;
use trillion3d_page_codec::edges::{canonical, first_uses, DirectedEdges};
use trillion3d_page_codec::partition::{Fork, Serial};

/// The compiler's pool runs the two halves of a large bisection side by side (`partition.rs`):
/// each half writes only its own ranks, so the parts are the serial cut's.
pub(crate) struct Pool;
impl Fork for Pool {
    fn fork(&self, a: &mut (dyn FnMut() + Send), b: &mut (dyn FnMut() + Send)) {
        rayon::join(|| a(), || b());
    }
}

/// The level-0 clusters of the source (`clusters_on`), the halves of a large cut on the pool.
pub fn cluster_source(
    positions: &[f32],
    indices: &[u32],
    max_triangles: usize,
) -> Result<Vec<Vec<u32>>> {
    clusters_on(positions, indices, max_triangles, &Pool)
}

/// The clusters a reduced group splits into (`clusters_on`), one cut after the other: the group
/// reductions already fill the pool.
pub fn cluster_triangles(
    positions: &[f32],
    indices: &[u32],
    max_triangles: usize,
) -> Result<Vec<Vec<u32>>> {
    clusters_on(positions, indices, max_triangles, &Serial)
}

/// The clusters of `indices` over `positions`, parts of `max_triangles - 4` to `max_triangles`
/// triangles of the triangles' graph, by the one clusterer (`trillion3d_page_codec::clusters`):
/// the run-time cut's too. No vertex cap: a cluster over `DAG_CLUSTER_VERTICES` is halved at
/// encode (`constrain_wide`). Each cluster's triangles keep their source order.
fn clusters_on(
    positions: &[f32],
    indices: &[u32],
    max_triangles: usize,
    fork: &dyn Fork,
) -> Result<Vec<Vec<u32>>> {
    if indices.is_empty() || !indices.len().is_multiple_of(3) {
        return Err(invalid("Index count must be a positive multiple of three"));
    }
    if max_triangles == 0 || !max_triangles.is_multiple_of(4) || max_triangles > 512 {
        return Err(invalid(
            "Cluster triangle budget must be a positive multiple of four up to 512",
        ));
    }
    let built = partition_triangles(positions, indices, max_triangles, fork);
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
        let mut first = std::mem::take(&mut dag[slot].indices);
        let second = first.split_off(cut);
        // The cluster copied without its triangles, then each half given its own.
        let mut half = dag[slot].clone();
        half.indices = second;
        dag[slot].indices = first;
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

/// Every directed edge between two positions (`weld`) of the triangles of `lists`, tagged by
/// `tag` of the list's rank, in runs (`DirectedEdges`), sorted on the pool.
fn directed_edges(
    lists: &[&[u32]],
    weld: &[u32],
    tag: impl Fn(usize) -> u32 + Sync,
) -> DirectedEdges {
    let edges = (lists.par_iter().enumerate())
        .flat_map_iter(|(id, indices)| {
            let tag = tag(id);
            indices.as_chunks::<3>().0.iter().flat_map(move |tri| {
                let tri = tri.map(|v| weld[v as usize]);
                (0..3).filter_map(move |k| {
                    let (a, b) = (tri[k], tri[(k + 1) % 3]);
                    (a != b).then_some((a, b, tag))
                })
            })
        })
        .collect();
    DirectedEdges::of(edges, |edges| edges.par_sort_unstable())
}

/// Shared edges between clusters, an edge named by its two positions (`weld`, the canonical
/// vertex per position): an edge one cluster runs from `a` to `b` and another from `b` to `a` joins
/// them, whatever copies of its ends each draws — a texture seam, a hard edge, a flat-shaded leaf
/// cut between them, each triangle on its own copies. Per cluster, its neighbours in order, each
/// with the count of such pairs of edges; an edge whose two ends lie on one position is no edge.
pub fn cluster_adjacency(clusters: &[&[u32]], weld: &[u32]) -> Vec<Vec<(u32, u32)>> {
    let edges = directed_edges(clusters, weld, |id| id as u32);
    let mut weights: Vec<WordMap<u32, u32>> = vec![WordMap::default(); clusters.len()];
    for run in 0..edges.runs() {
        let (a, b, _) = edges.run(run)[0];
        // Each pair of opposite edges once: from the run whose edge starts at the lower position.
        let Some(back) = edges.back(run).filter(|_| a < b) else {
            continue;
        };
        for &(_, _, x) in edges.run(run) {
            for &(_, _, y) in edges.run(back) {
                if x != y {
                    *weights[x as usize].entry(y).or_insert(0) += 1;
                    *weights[y as usize].entry(x).or_insert(0) += 1;
                }
            }
        }
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

/// Canonical vertex per position: duplicated vertices at UV or normal seams are one point, so a
/// lock placed on one copy locks every copy and no seam can crack.
pub fn weld_positions(positions: &[f32], indices: &[u32]) -> Vec<u32> {
    weld_by(positions.len() / 3, indices, |id| {
        position_key(positions, id)
    })
}
/// Canonical vertex per `key` (`trillion3d_page_codec::edges::canonical`), the keys made and
/// sorted on the pool: each vertex `indices` names takes the first in their order with its key;
/// one the list never names stays its own.
pub(super) fn weld_by<K: Ord + Send>(
    count: usize,
    indices: &[u32],
    key: impl Fn(u32) -> K + Sync,
) -> Vec<u32> {
    let first = first_uses(count, indices);
    let mut named: Vec<(K, u32, u32)> = (0..count as u32)
        .into_par_iter()
        .filter(|&v| first[v as usize] != u32::MAX)
        .map(|v| (key(v), first[v as usize], v))
        .collect();
    named.par_sort_unstable_by(|x, y| (&x.0, x.1).cmp(&(&y.0, y.1)));
    canonical(count, &named)
}
/// Lock table for one level, per vertex: its position ends an external edge of its group — an
/// edge of the group's triangles that a triangle of another group of the level runs back, from
/// its second position to its first. Simplifying a group moves its external edges at a price
/// only (`qem_simplifier.rs`), so the cut keeps meeting its neighbours there. The primitive's own
/// open boundary, and a position two groups share only at a corner, stay free.
pub fn level_locks(weld: &[u32], clusters: &[&[u32]], groups: &[Vec<usize>]) -> Vec<bool> {
    // Every directed edge between two positions, with the group of the triangle running it.
    let mut group_of = vec![0u32; clusters.len()];
    for (id, group) in groups.iter().enumerate() {
        group.iter().for_each(|&slot| group_of[slot] = id as u32);
    }
    let in_groups: Vec<&[u32]> = groups
        .iter()
        .flatten()
        .map(|&slot| clusters[slot])
        .collect();
    let tags: Vec<u32> = groups
        .iter()
        .flatten()
        .map(|&slot| group_of[slot])
        .collect();
    let edges = directed_edges(&in_groups, weld, |rank| tags[rank]);
    // An edge some group runs and another runs back locks its two positions.
    let mut locked_position = vec![false; weld.len()];
    for run in 0..edges.runs() {
        let Some(back) = edges.back(run) else {
            continue;
        };
        let groups_of = edges.run(run).iter().chain(edges.run(back)).map(|e| e.2);
        let (low, high) = groups_of.fold((u32::MAX, 0), |(l, h), g| (l.min(g), h.max(g)));
        if low != high {
            let (a, b, _) = edges.run(run)[0];
            locked_position[a as usize] = true;
            locked_position[b as usize] = true;
        }
    }
    (0..weld.len())
        .map(|vertex| locked_position[weld[vertex] as usize])
        .collect()
}
