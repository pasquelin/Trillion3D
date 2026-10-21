use super::clusters::Pool;
use super::*;
use trillion3d_math::geometry::aabb::aabb_of_f32;
use trillion3d_math::join::{GreatestRoot, Join};
use trillion3d_math::vector::vec3::point_checked_f32;
use trillion3d_page_codec::partition::Partitioner;

/// The cost of a shared edge between two clusters a group's simplification made together, and
/// between any other two; every pair that shares an edge adds `LINK_COST`, a locality link
/// `LOCALITY_COST`.
const SIBLING_EDGE_COST: i32 = 12;
const EDGE_COST: i32 = 16;
const LINK_COST: i32 = 4;
const LOCALITY_COST: i32 = 1;

/// The groups of a level's clusters, by their `boxes`, parts of `DAG_GROUP_MIN` to
/// `DAG_GROUP_MAX` clusters of the clusters' graph (`Partitioner`): two clusters that share edges
/// (`adjacency`, `cluster_adjacency`, each cluster's neighbours in the level's order) are joined
/// at `EDGE_COST` per edge — `SIBLING_EDGE_COST` when one group made both (`sources`) — plus
/// `LINK_COST`; a cluster of a small island links its nearest clusters of other islands at
/// `LOCALITY_COST` (`Partitioner::locality_links`, by the centres of the clusters' boxes within
/// `bounds`, the box every level's clusters reached so far). A level of at most `DAG_GROUP_MAX`
/// clusters is one group. Each group's members in partition order, the groups in that order.
pub fn group_clusters(
    boxes: &[([f32; 3], [f32; 3])],
    bounds: ([f32; 3], [f32; 3]),
    sources: &[Option<usize>],
    adjacency: &[Vec<(u32, u32)>],
) -> Vec<Vec<usize>> {
    let n = boxes.len();
    if n <= DAG_GROUP_MAX {
        return vec![(0..n).collect()];
    }
    let mut islands = Join::<GreatestRoot>::new(n);
    for (id, neighbours) in adjacency.iter().enumerate() {
        for &(other, _) in neighbours {
            islands.unite(id as u32, other);
        }
    }
    let centres: Vec<[f32; 3]> = (boxes.iter())
        .map(|(low, high)| [0, 1, 2].map(|k| 0.5 * (low[k] + high[k])))
        .collect();
    let mut partitioner = Partitioner::new(n, DAG_GROUP_MIN, DAG_GROUP_MAX);
    partitioner.locality_links(&mut islands, bounds, &centres);
    let own_links = adjacency.iter().map(Vec::len).sum();
    let graph = partitioner.graph(own_links, LOCALITY_COST, |c, links| {
        let source = sources[c as usize];
        for &(other, shared) in &adjacency[c as usize] {
            let siblings = source.is_some() && source == sources[other as usize];
            let per_edge = if siblings {
                SIBLING_EDGE_COST
            } else {
                EDGE_COST
            };
            links.push((other, shared as i32 * per_edge + LINK_COST));
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

/// The box of the vertices a cluster's triangles `list` name over `positions`, in `f32`.
pub(super) fn cluster_box(positions: &[f32], list: &[u32]) -> ([f32; 3], [f32; 3]) {
    aabb_of_f32((list.iter()).filter_map(|&v| point_checked_f32(positions, v as usize)))
}
