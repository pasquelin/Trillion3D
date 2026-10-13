//! THE CULLING HIERARCHY BUILDER, one for the native compiler's primitives and world, and for the
//! cuts the world makes at run time (`wasm_culling.rs`, in the page worker): clusters as their boxes,
//! levels and replacement bands in, a cluster order and the nodes the GPU descent reads out. Pages
//! follow the order, so every node owns a contiguous page range.
use crate::min_ball::ball_of_balls;
use crate::split::{bisect_least_cost, sort_along};
use trillion3d_math::aabb::{aabb_of_boxes, centre};

mod layout;

/// Children of an inner node: three median splits.
pub const CULLING_BRANCHING: usize = 8;
/// Clusters a leaf holds at most.
pub const CULLING_LEAF: usize = 8;
/// Numbers per node in the flat layout the manifest and the run-time cut carry: box, sphere,
/// replacement error ceiling (-1 over a subtree holding a root), first child, child count, first
/// cluster, cluster count.
pub const CULLING_STRIDE: usize = 15;

/// One cluster as the hierarchy sees it: its box, its level, and the band of what replaces it
/// (`parent_error` infinite for a root, which nothing replaces).
#[derive(Clone, Copy, Debug)]
pub struct CullingCluster {
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub level: usize,
    pub parent_sphere: [f64; 4],
    pub parent_error: f64,
}

/// Numbers per cluster record, the run-time cut's input (`wasm_culling.rs`): the box's least corner
/// then its greatest, the sphere of what replaces it, its replacement error (infinite for a root)
/// and its level.
pub const CULLING_RECORD_FLOATS: usize = 12;

/// One node of the per-primitive culling hierarchy.
///
/// `sphere` encloses every `parent_sphere` of the subtree and `max_parent_error` is the largest
/// `parent_error` in it, so a single projection bounds the whole subtree from above: when that bound
/// already fits the pixel budget, no cluster below can be selected and the subtree is skipped.
#[derive(Clone, Debug, Default)]
pub struct CullingNode {
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub sphere: [f64; 4],
    pub max_parent_error: f64,
    pub first_child: usize,
    pub child_count: usize,
    pub first_cluster: usize,
    pub cluster_count: usize,
}

/// Node bounds: cluster box, sphere enclosing replacement spheres (`ball_of_balls`),
/// and max subtree replacement error. Single interval reading serves
/// root covering whole order as well as node covering slice.
fn node_bounds(span: &[usize], clusters: &[CullingCluster]) -> ([f64; 3], [f64; 3], [f64; 4], f64) {
    let (min, max) = aabb_of_boxes(span.iter().map(|&id| (clusters[id].min, clusters[id].max)));
    let mut spheres = Vec::with_capacity(span.len());
    let mut max_parent_error = 0.0_f64;
    for &id in span {
        spheres.push(clusters[id].parent_sphere);
        if clusters[id].parent_error > max_parent_error {
            max_parent_error = clusters[id].parent_error;
        }
    }
    (min, max, ball_of_balls(&spheres), max_parent_error)
}

/// The hierarchy over `clusters`: the root splits by level first, then every node by three median
/// splits of its clusters' centres, each on the axis of least cost (`bisect_least_cost`), down
/// to leaves of `CULLING_LEAF` clusters, each leaf's clusters in their order on the axis that last
/// split it; no cluster gives one empty leaf. Returns the cluster order (rank to cluster) and the
/// nodes, numbered level by level from the root: a balanced tree, its depth
/// `⌈log₈(n / CULLING_LEAF)⌉` past the levels, built in `O(n log n)`.
pub fn build_culling_bvh(clusters: &[CullingCluster]) -> (Vec<usize>, Vec<CullingNode>) {
    let mut order: Vec<usize> = (0..clusters.len()).collect();
    // No cluster: one empty leaf, so the descent still has a root to start from.
    let mut nodes: Vec<CullingNode> = vec![CullingNode::default()];
    if clusters.is_empty() {
        return (order, nodes);
    }
    let centres: Vec<[f64; 3]> = clusters
        .iter()
        .map(|cluster| centre(cluster.min, cluster.max))
        .collect();
    order.sort_unstable_by_key(|&id| (clusters[id].level, id));
    let mut level_ranges = Vec::new();
    let mut start = 0usize;
    while start < order.len() {
        let level = clusters[order[start]].level;
        let mut end = start + 1;
        while end < order.len() && clusters[order[end]].level == level {
            end += 1;
        }
        level_ranges.push((start, end));
        start = end;
    }
    let mut queue = std::collections::VecDeque::new();
    if level_ranges.len() < 2 {
        queue.push_back((0usize, 0usize, clusters.len(), None));
    } else {
        let first_child = 1usize;
        nodes[0].first_child = first_child;
        nodes[0].child_count = level_ranges.len();
        nodes.resize(first_child + level_ranges.len(), CullingNode::default());
        for (offset, &(from, to)) in level_ranges.iter().enumerate() {
            queue.push_back((first_child + offset, from, to, None));
        }
        let (min, max, sphere, max_parent_error) = node_bounds(&order, clusters);
        nodes[0].min = min;
        nodes[0].max = max;
        nodes[0].sphere = sphere;
        nodes[0].max_parent_error = max_parent_error;
    }
    while let Some((index, start, end, split)) = queue.pop_front() {
        let (min, max, sphere, max_parent_error) = node_bounds(&order[start..end], clusters);
        nodes[index].min = min;
        nodes[index].max = max;
        nodes[index].sphere = sphere;
        nodes[index].max_parent_error = max_parent_error;
        if end - start <= CULLING_LEAF {
            // A selection leaves a half in no order: a leaf's pages follow its split axis.
            if let Some(axis) = split {
                sort_along(&mut order[start..end], &centres, axis);
            }
            nodes[index].first_cluster = start;
            nodes[index].cluster_count = end - start;
            continue;
        }
        // Three median splits give the eight children.
        let mut ranges = vec![(start, end, split)];
        for _ in 0..CULLING_BRANCHING.trailing_zeros() {
            let mut next = Vec::with_capacity(ranges.len() * 2);
            for (from, to, axis) in ranges {
                if to - from < 2 {
                    next.push((from, to, axis));
                    continue;
                }
                let bounds = |id: usize| (clusters[id].min, clusters[id].max);
                let axis =
                    bisect_least_cost(&mut order[from..to], &centres, bounds, (to - from) / 2);
                let middle = from + (to - from) / 2;
                next.push((from, middle, Some(axis)));
                next.push((middle, to, Some(axis)));
            }
            ranges = next;
        }
        let ranges: Vec<_> = ranges
            .into_iter()
            .filter(|(from, to, _)| to > from)
            .collect();
        let first_child = nodes.len();
        nodes[index].first_child = first_child;
        nodes[index].child_count = ranges.len();
        nodes.resize(first_child + ranges.len(), CullingNode::default());
        for (offset, (from, to, axis)) in ranges.into_iter().enumerate() {
            queue.push_back((first_child + offset, from, to, axis));
        }
    }
    (order, nodes)
}

#[cfg(test)]
pub(crate) mod families;
#[cfg(test)]
#[path = "culling_tests.rs"]
mod tests;
