//! THE CULLING HIERARCHY BUILDER, one for the native compiler's primitives and world, and for the
//! cuts the world makes at run time (`wasm_culling.rs`, in the page worker): clusters as their boxes,
//! levels and replacement bands in, a cluster order and the nodes the GPU descent reads out. Pages
//! follow the order, so every node owns a contiguous page range.
use crate::min_ball::ball_of_balls;
use trillion3d_math::aabb::{aabb_of, aabb_of_boxes, centre, longest_axis};

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

impl CullingNode {
    /// The node in the flat layout (`CULLING_STRIDE` numbers): an infinite ceiling is written -1.
    pub fn flat(&self) -> [f64; CULLING_STRIDE] {
        let mut out = [0.0; CULLING_STRIDE];
        out[..3].copy_from_slice(&self.min);
        out[3..6].copy_from_slice(&self.max);
        out[6..10].copy_from_slice(&self.sphere);
        out[10] = if self.max_parent_error.is_finite() {
            self.max_parent_error
        } else {
            -1.0
        };
        out[11] = self.first_child as f64;
        out[12] = self.child_count as f64;
        out[13] = self.first_cluster as f64;
        out[14] = self.cluster_count as f64;
        out
    }
}

/// Sorts group of ids on widest axis of centroids: median falls
/// on `slice.len() / 2`, splitting group into two spatial halves.
///
/// Comparator sorts by coordinate (`total_cmp`, so NaN has a place), then by
/// identifier: two coincident centroids keep same order from build to build.
pub fn bisect_centres(slice: &mut [usize], centres: &[[f64; 3]]) {
    let (low, high) = aabb_of(slice.iter().map(|&id| centres[id]));
    let axis = longest_axis(&low, &high);
    slice.sort_unstable_by(|&x, &y| {
        centres[x][axis]
            .total_cmp(&centres[y][axis])
            .then(x.cmp(&y))
    });
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
/// splits of its clusters' centres on the longest axis, down to leaves of `CULLING_LEAF` clusters.
/// Returns the cluster order (rank to cluster) and the nodes, numbered level by level from the root.
pub fn build_culling_bvh(clusters: &[CullingCluster]) -> (Vec<usize>, Vec<CullingNode>) {
    let mut order: Vec<usize> = (0..clusters.len()).collect();
    let mut nodes: Vec<CullingNode> = Vec::new();
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
    nodes.push(CullingNode::default());
    let mut queue = std::collections::VecDeque::new();
    if level_ranges.len() < 2 {
        queue.push_back((0usize, 0usize, clusters.len()));
    } else {
        let first_child = 1usize;
        nodes[0].first_child = first_child;
        nodes[0].child_count = level_ranges.len();
        nodes.resize(first_child + level_ranges.len(), CullingNode::default());
        for (offset, &(from, to)) in level_ranges.iter().enumerate() {
            queue.push_back((first_child + offset, from, to));
        }
        let (min, max, sphere, max_parent_error) = node_bounds(&order, clusters);
        nodes[0].min = min;
        nodes[0].max = max;
        nodes[0].sphere = sphere;
        nodes[0].max_parent_error = max_parent_error;
    }
    while let Some((index, start, end)) = queue.pop_front() {
        let (min, max, sphere, max_parent_error) = node_bounds(&order[start..end], clusters);
        nodes[index].min = min;
        nodes[index].max = max;
        nodes[index].sphere = sphere;
        nodes[index].max_parent_error = max_parent_error;
        if end - start <= CULLING_LEAF {
            nodes[index].first_cluster = start;
            nodes[index].cluster_count = end - start;
            continue;
        }
        // Three median splits on the longest axis give the eight children.
        let mut ranges = vec![(start, end)];
        for _ in 0..CULLING_BRANCHING.trailing_zeros() {
            let mut next = Vec::with_capacity(ranges.len() * 2);
            for (from, to) in ranges {
                if to - from < 2 {
                    next.push((from, to));
                    continue;
                }
                bisect_centres(&mut order[from..to], &centres);
                let middle = from + (to - from) / 2;
                next.push((from, middle));
                next.push((middle, to));
            }
            ranges = next;
        }
        let ranges: Vec<(usize, usize)> =
            ranges.into_iter().filter(|(from, to)| to > from).collect();
        let first_child = nodes.len();
        nodes[index].first_child = first_child;
        nodes[index].child_count = ranges.len();
        nodes.resize(first_child + ranges.len(), CullingNode::default());
        for (offset, (from, to)) in ranges.into_iter().enumerate() {
            queue.push_back((first_child + offset, from, to));
        }
    }
    (order, nodes)
}

#[cfg(test)]
#[path = "culling_tests.rs"]
mod tests;
