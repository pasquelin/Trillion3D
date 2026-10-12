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

/// Numbers per cluster record, the run-time cut's input (`wasm_culling.rs`): the box's least corner
/// then its greatest, the sphere of what replaces it, its replacement error (infinite for a root)
/// and its level.
pub const CULLING_RECORD_FLOATS: usize = 12;

impl CullingCluster {
    /// The cluster as its record.
    pub fn record(&self) -> [f64; CULLING_RECORD_FLOATS] {
        let mut out = [0.0; CULLING_RECORD_FLOATS];
        out[..3].copy_from_slice(&self.min);
        out[3..6].copy_from_slice(&self.max);
        out[6..10].copy_from_slice(&self.parent_sphere);
        out[10] = self.parent_error;
        out[11] = self.level as f64;
        out
    }

    /// The cluster of record `r`, `None` when its level is not a whole number under `2^32`.
    pub fn from_record(r: &[f64]) -> Option<Self> {
        let level = r[11];
        (level >= 0.0 && level.fract() == 0.0 && level < 4_294_967_296.0).then(|| Self {
            min: [r[0], r[1], r[2]],
            max: [r[3], r[4], r[5]],
            parent_sphere: [r[6], r[7], r[8], r[9]],
            parent_error: r[10],
            level: level as usize,
        })
    }
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

/// The order of two ids by their centres' coordinate on `axis` (`total_cmp`, so NaN has a place),
/// then by identifier: two coincident centres keep the same order from build to build.
fn along(centres: &[[f64; 3]], axis: usize) -> impl Fn(&usize, &usize) -> std::cmp::Ordering + '_ {
    move |&x, &y| {
        centres[x][axis]
            .total_cmp(&centres[y][axis])
            .then(x.cmp(&y))
    }
}

/// Puts the median of `slice` on `axis` at `slice.len() / 2` by selection, in linear time: every id
/// before it comes first in the order of `along`, every one after it later, each half in no order.
pub fn select_median(slice: &mut [usize], centres: &[[f64; 3]], axis: usize) {
    if slice.len() > 1 {
        slice.select_nth_unstable_by(slice.len() / 2, along(centres, axis));
    }
}

/// Sorts `slice` in the order of `along` on `axis`.
pub fn sort_along(slice: &mut [usize], centres: &[[f64; 3]], axis: usize) {
    slice.sort_unstable_by(along(centres, axis));
}

/// Splits a group of ids in two spatial halves on the widest axis of their centres: the median
/// falls on `slice.len() / 2` (`select_median`). Returns that axis; a caller that reads the halves
/// in order sorts them on it (`sort_along`), which gives the order a full sort gives.
pub fn bisect_centres(slice: &mut [usize], centres: &[[f64; 3]]) -> usize {
    let (low, high) = aabb_of(slice.iter().map(|&id| centres[id]));
    let axis = longest_axis(&low, &high);
    select_median(slice, centres, axis);
    axis
}

/// The surface of a box, half of it: what a split of a node into two halves is priced by.
fn half_area(min: [f64; 3], max: [f64; 3]) -> f64 {
    let [x, y, z] = [0, 1, 2].map(|a| max[a] - min[a]);
    x * y + y * z + z * x
}

/// Splits `slice` at its median on the axis whose two halves' boxes have the least surface, of
/// the three: the halves a view's frustum and occlusion tests reject most often. Each axis costs
/// one selection and one pass over the boxes, so a split stays linear. Returns that axis.
fn bisect_least_surface(
    slice: &mut [usize],
    centres: &[[f64; 3]],
    clusters: &[CullingCluster],
) -> usize {
    let middle = slice.len() / 2;
    let boxes =
        |part: &[usize]| aabb_of_boxes(part.iter().map(|&id| (clusters[id].min, clusters[id].max)));
    let mut best: Option<(f64, usize)> = None;
    for axis in 0..3 {
        select_median(slice, centres, axis);
        let (low, high) = boxes(&slice[..middle]);
        let (low1, high1) = boxes(&slice[middle..]);
        let cost = half_area(low, high) + half_area(low1, high1);
        if best.is_none_or(|(least, _)| cost < least) {
            best = Some((cost, axis));
        }
    }
    let axis = best.map_or(0, |(_, axis)| axis);
    if axis != 2 {
        select_median(slice, centres, axis);
    }
    axis
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
/// splits of its clusters' centres, each on the axis of least surface (`bisect_least_surface`), down
/// to leaves of `CULLING_LEAF` clusters, each leaf's clusters in their order on the axis that last
/// split it. Returns the cluster order (rank to cluster) and the nodes, numbered level by level
/// from the root: a balanced tree, its depth `⌈log₈(n / CULLING_LEAF)⌉` past the levels, built in
/// `O(n log n)`.
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
                let axis = bisect_least_surface(&mut order[from..to], &centres, clusters);
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
#[path = "culling_tests.rs"]
pub(crate) mod tests;
