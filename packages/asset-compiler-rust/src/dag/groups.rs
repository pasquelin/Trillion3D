use super::clusters::Pool;
use super::*;
pub use trillion3d_page_codec::clusters::vertex_bounds;
use trillion3d_page_codec::partition::{Islands, Partitioner};

/// The cost of a shared edge between two clusters a group's simplification made together, and
/// between any other two; every pair that shares an edge adds `LINK_COST`, a locality link
/// `LOCALITY_COST`.
const SIBLING_EDGE_COST: i64 = 12;
const EDGE_COST: i64 = 16;
const LINK_COST: i64 = 4;
const LOCALITY_COST: i64 = 1;

/// The groups of a level's clusters (`lists`, indexing `positions`), parts of `DAG_GROUP_MIN` to
/// `DAG_GROUP_MAX` clusters of the clusters' graph (`Partitioner`): two clusters that share edges
/// (`adjacency`, `cluster_adjacency`) are joined at `EDGE_COST` per edge — `SIBLING_EDGE_COST`
/// when one group made both (`sources`) — plus `LINK_COST`; a cluster of a small island links its
/// nearest clusters of other islands at `LOCALITY_COST` (`Partitioner::locality_links`, by the
/// centres of the clusters' boxes within `bounds`, the box of the source's positions). A level of
/// at most `DAG_GROUP_MAX` clusters is one group. Each group's members in partition order, the
/// groups in that order.
pub fn group_clusters(
    lists: &[&[u32]],
    positions: &[f32],
    bounds: ([f32; 3], [f32; 3]),
    sources: &[Option<usize>],
    adjacency: &[Vec<(u32, u32)>],
) -> Vec<Vec<usize>> {
    let n = lists.len();
    if n <= DAG_GROUP_MAX {
        return vec![(0..n).collect()];
    }
    let mut islands = Islands::new(n);
    for (id, neighbours) in adjacency.iter().enumerate() {
        for &(other, _) in neighbours {
            islands.union(id as u32, other);
        }
    }
    let centres: Vec<[f32; 3]> = lists
        .iter()
        .map(|list| box_centre(positions, list))
        .collect();
    let mut partitioner = Partitioner::new(n, DAG_GROUP_MIN, DAG_GROUP_MAX);
    partitioner.locality_links(&mut islands, bounds, |c| centres[c as usize]);
    let graph = partitioner.graph(LOCALITY_COST, |c, links| {
        let source = sources[c as usize];
        for &(other, shared) in &adjacency[c as usize] {
            let siblings = source.is_some() && source == sources[other as usize];
            let per_edge = if siblings {
                SIBLING_EDGE_COST
            } else {
                EDGE_COST
            };
            links.push((other, shared as i64 * per_edge + LINK_COST));
        }
    });
    partitioner.partition(graph, &Pool);
    (partitioner.parts.iter())
        .map(|part| {
            (partitioner.ranks[part.clone()].iter())
                .map(|&c| c as usize)
                .collect()
        })
        .collect()
}

/// The centre of the box of the vertices a cluster names, in `f32`.
fn box_centre(positions: &[f32], list: &[u32]) -> [f32; 3] {
    let mut low = [f32::INFINITY; 3];
    let mut high = [f32::NEG_INFINITY; 3];
    for &v in list {
        let i = v as usize * 3;
        if let Some(p) = positions.get(i..i + 3) {
            for k in 0..3 {
                low[k] = low[k].min(p[k]);
                high[k] = high[k].max(p[k]);
            }
        }
    }
    [0, 1, 2].map(|k| 0.5 * (low[k] + high[k]))
}
