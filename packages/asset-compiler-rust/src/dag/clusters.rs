//! The DAG's cuts and cluster graph: the level-0 clusters and a reduced group's re-split, each
//! with its external edges (`Cut`); the clusters a level's groups are made of, joined by the
//! external edges they share (`cluster_adjacency`); and the encoder's steps once every level is
//! built: the triangles with two equal corners dropped (`remove_degenerate`), then the strips
//! (`constrain_wide`).
//!
//! **External edges.** Every corner of a cluster carries a count: how many edges of other
//! clusters its edge (from the corner to the next of its triangle) runs along. A cut adds, to the
//! count it is handed, each link of the edge to a triangle of another of its parts
//! (`partition_triangles`); a level of more than `DAG_GROUP_MAX` clusters keeps, of each counted
//! edge, the edges of other clusters that run it back between the same two positions, and an edge
//! no other cluster runs back counts no more (`cluster_adjacency`; a level of one group leaves its
//! clusters their counts); a group takes away the edges of its own other children
//! (`border.rs`), locks the ends of what is left, and its solve's edges that are still one of
//! them take their count back. An edge a simplification lays along a neighbour's without having
//! been counted stays free.
use super::*;
use trillion3d_page_codec::clusters::strip::constrained;
use trillion3d_page_codec::clusters::{named_bounds, partition_triangles, vertex_bounds, Linking};
pub(super) use trillion3d_page_codec::edges::first_uses;
pub(super) use trillion3d_page_codec::edges::position_key;
use trillion3d_page_codec::edges::{canonical, DirectedEdges};
use trillion3d_page_codec::partition::{Fork, Serial};

/// The most edges of other clusters a level counts along one edge (`cluster_adjacency`).
const MOST_MATCHES: usize = 127;

/// The compiler's pool runs the two halves of a large bisection side by side (`partition.rs`):
/// each half writes only its own ranks, so the parts are the serial cut's.
pub(crate) struct Pool;
impl Fork for Pool {
    fn fork(&self, a: &mut (dyn FnMut() + Send), b: &mut (dyn FnMut() + Send)) {
        rayon::join(|| a(), || b());
    }
}

/// Clusters as a cut made them: each one's triangles and, per corner, its external edges (the
/// module's counts).
pub struct Cut {
    pub clusters: Vec<Vec<u32>>,
    pub outer: Vec<Vec<u8>>,
}

/// The level-0 clusters of the source (`clusters_on`): a source's links, within the box of the
/// vertices it names, the halves of a large cut on the pool, each edge counting the links it has
/// to the triangles of other clusters.
pub fn cluster_source(positions: &[f32], indices: &[u32], max_triangles: usize) -> Result<Cut> {
    let bounds = named_bounds(positions, indices);
    let limits = (max_triangles, bounds);
    clusters_on(positions, indices, limits, (Linking::Source, &Pool), &[])
}

/// The clusters a reduced group splits into (`clusters_on`): a re-split's links, within the box of
/// the region's vertices — the children's and every one the solve placed —, one cut after the
/// other: the group reductions already fill the pool. Each edge counts what `carried` counts of
/// its corner, plus its links to the triangles of the group's other new clusters.
pub fn cluster_triangles(
    positions: &[f32],
    indices: &[u32],
    max_triangles: usize,
    carried: &[u8],
) -> Result<Cut> {
    let bounds = vertex_bounds(positions);
    let limits = (max_triangles, bounds);
    clusters_on(
        positions,
        indices,
        limits,
        (Linking::Resplit, &Serial),
        carried,
    )
}

/// The clusters of `indices` over `positions`, parts of `max_triangles - 4` to `max_triangles`
/// triangles of the triangles' graph, its edges linked the way `linking` names, its locality order
/// laid on `bounds`, by the one clusterer (`trillion3d_page_codec::clusters`): the run-time cut's
/// too. No vertex cap: a cluster's strips over `DAG_CLUSTER_VERTICES` are halved at encode
/// (`constrain_wide`). Each cluster's triangles in the partition's order, with their external
/// edges, `carried` the counts the corners of `indices` already hold.
fn clusters_on(
    positions: &[f32],
    indices: &[u32],
    (max_triangles, bounds): (usize, ([f32; 3], [f32; 3])),
    (linking, fork): (Linking, &dyn Fork),
    carried: &[u8],
) -> Result<Cut> {
    if indices.is_empty() || !indices.len().is_multiple_of(3) {
        return Err(invalid("Index count must be a positive multiple of three"));
    }
    if max_triangles == 0 || !max_triangles.is_multiple_of(4) || max_triangles > 512 {
        return Err(invalid(
            "Cluster triangle budget must be a positive multiple of four up to 512",
        ));
    }
    let limits = (max_triangles, bounds);
    let (built, outer) = partition_triangles(positions, indices, limits, linking, fork, carried);
    let mut start = 0;
    let (clusters, outer): (Vec<Vec<u32>>, Vec<Vec<u8>>) = (built.ends.iter())
        .map(|&end| {
            let range = start..end;
            start = end;
            (built.indices[range.clone()].to_vec(), outer[range].to_vec())
        })
        .unzip();
    Ok(Cut { clusters, outer })
}

/// Every cluster of `dag` without its triangles two of whose corners are one vertex (equal
/// indices), the others in their order. The encoder's first step once every level is built,
/// before the strips (`constrain_wide`); the clusters go side by side on the pool.
pub(super) fn remove_degenerate(dag: &mut [DagCluster]) {
    dag.par_iter_mut().for_each(|cluster| {
        let indices = &mut cluster.indices;
        let mut kept = 0;
        for triangle in 0..indices.len() / 3 {
            let at = triangle * 3;
            let (i0, i1, i2) = (indices[at], indices[at + 1], indices[at + 2]);
            if i0 != i1 && i0 != i2 && i1 != i2 {
                indices.copy_within(at..at + 3, kept * 3);
                kept += 1;
            }
        }
        indices.truncate(kept * 3);
    });
}

/// The DAG's clusters laid as the encoder lays them, once every level is built: every cluster's
/// triangles in strips over `positions` (`strip::constrained`), and each whose strips lay more
/// than `DAG_CLUSTER_VERTICES` vertices cut after the first half of its laid triangles, each half
/// laid again; the first half keeps its slot, the second takes a new one after every cluster,
/// with the same level, errors, spheres and links, listed among the children of the group that
/// replaces it and among the outputs of the group that made it, and both keep the whole
/// cluster's box (`DagCluster::whole_box`). A half is never over the cap: 64 triangles lay 192
/// vertices at most. The clusters are laid side by side on the pool, each on its own.
pub(super) fn constrain_wide(
    positions: &[f32],
    dag: &mut Vec<DagCluster>,
    groups: &mut [DagGroup],
) {
    let laid: Vec<_> = (dag.par_iter())
        .map(|cluster| constrained(positions, &cluster.indices, DAG_CLUSTER_VERTICES))
        .collect();
    for (slot, laid) in laid.into_iter().enumerate() {
        let Some(second) = laid.second else {
            dag[slot].indices = laid.first;
            continue;
        };
        dag[slot].whole_box = Some(dag[slot].drawn_box(positions));
        // The cluster copied without its triangles, then each half given its own.
        dag[slot].indices = Vec::new();
        let mut half = dag[slot].clone();
        dag[slot].indices = laid.first;
        half.indices = second;
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

/// The clusters of a level joined by their external edges (the module's counts: `outer`, one
/// list per cluster, aligned with its corners), an edge named by its two positions (`weld`, the
/// canonical vertex per position): a counted edge one cluster runs from `a` to `b` joins every
/// other cluster running a counted edge from `b` to `a`, whatever copies of its ends each draws —
/// a texture seam, a hard edge, a flat-shaded leaf cut between them. Per cluster, its neighbours
/// in order, each with the count of such pairs of edges; and each counted edge now counts the
/// edges of other clusters it so meets, at most `MOST_MATCHES`, zero when it meets none. An edge
/// whose two ends lie on one position is no edge.
pub fn cluster_adjacency(
    clusters: &[&[u32]],
    outer: &mut [Vec<u8>],
    weld: &[u32],
) -> Vec<Vec<(u32, u32)>> {
    // Every counted edge, tagged by its corner's rank among the level's corners.
    let starts: Vec<u32> = (clusters.iter())
        .scan(0u32, |at, cluster| {
            let start = *at;
            *at += cluster.len() as u32;
            Some(start)
        })
        .collect();
    let edges = (clusters.par_iter().zip(&*outer).zip(&starts))
        .flat_map_iter(|((indices, counts), &start)| {
            let triangles = indices.as_chunks::<3>().0.iter().enumerate();
            triangles.flat_map(move |(t, tri)| {
                let tri = tri.map(|v| weld[v as usize]);
                (0..3).filter_map(move |k| {
                    let (a, b, corner) = (tri[k], tri[(k + 1) % 3], t * 3 + k);
                    (counts[corner] != 0 && a != b).then_some((a, b, start + corner as u32))
                })
            })
        })
        .collect();
    let edges = DirectedEdges::of(edges, |edges| edges.par_sort_unstable());
    let cluster_of = |corner: u32| starts.partition_point(|&start| start <= corner) - 1;
    let total: usize = clusters.iter().map(|c| c.len()).sum();
    let mut matched = vec![0u8; total];
    // Every pair of neighbouring clusters, once per pair of opposite edges, both ways round.
    let mut pairs: Vec<(u32, u32)> = Vec::new();
    for run in 0..edges.runs() {
        let Some(back) = edges.back(run) else {
            continue;
        };
        let (a, b, _) = edges.run(run)[0];
        for &(_, _, x) in edges.run(run) {
            let cx = cluster_of(x);
            let mut met = 0usize;
            for &(_, _, y) in edges.run(back) {
                let cy = cluster_of(y);
                if cy == cx {
                    continue;
                }
                met += 1;
                // Each pair of opposite edges once: from the run whose edge starts at the lower
                // position.
                if a < b {
                    pairs.extend([(cx as u32, cy as u32), (cy as u32, cx as u32)]);
                }
            }
            matched[x as usize] = met.min(MOST_MATCHES) as u8;
        }
    }
    for (counts, &start) in outer.iter_mut().zip(&starts) {
        let end = start as usize + counts.len();
        counts.copy_from_slice(&matched[start as usize..end]);
    }
    // Per cluster, its neighbours in order, each with the count of its pairs.
    pairs.par_sort_unstable();
    let mut neighbours: Vec<Vec<(u32, u32)>> = vec![Vec::new(); clusters.len()];
    for run in pairs.chunk_by(|x, y| x == y) {
        let (cluster, other) = run[0];
        neighbours[cluster as usize].push((other, run.len() as u32));
    }
    neighbours
}

/// Canonical vertex per position: duplicated vertices at UV or normal seams are one point, so a
/// lock placed on one copy locks every copy and no seam can crack.
pub fn weld_positions(positions: &[f32], indices: &[u32]) -> Vec<u32> {
    let first = first_uses(positions.len() / 3, indices);
    weld_by(&first, |id| position_key(positions, id))
}
/// Canonical vertex per `key` (`trillion3d_page_codec::edges::canonical`), the keys made and
/// sorted on the pool: each vertex the index list names takes the first in its order with its
/// key, `first` each vertex's first use in it (`first_uses`); one the list never names stays its
/// own.
pub(super) fn weld_by<K: Ord + Send>(first: &[u32], key: impl Fn(u32) -> K + Sync) -> Vec<u32> {
    let mut named = named_by(first, key);
    named.par_sort_unstable_by(|x, y| (&x.0, x.1).cmp(&(&y.0, y.1)));
    canonical(first.len(), &named)
}
/// Every vertex the index list names as (`key`, first use, vertex), the keys made on the pool, in
/// vertex order; `first` each vertex's first use in the list (`first_uses`).
pub(super) fn named_by<K: Send>(
    first: &[u32],
    key: impl Fn(u32) -> K + Sync,
) -> Vec<(K, u32, u32)> {
    (0..first.len() as u32)
        .into_par_iter()
        .filter(|&v| first[v as usize] != u32::MAX)
        .map(|v| (key(v), first[v as usize], v))
        .collect()
}
