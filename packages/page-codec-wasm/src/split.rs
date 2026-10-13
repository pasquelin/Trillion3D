//! THE MEDIAN SPLIT of a group of ids by their centres, one for every tree built over boxed things:
//! the culling hierarchy (`culling.rs`) and the DAG's groups (`asset-compiler-rust/src/dag/groups.rs`).
//! A split is a selection, linear in the group, never a sort; a caller that reads a half in order
//! sorts it (`sort_along`). Ties break by identifier, so a tree is the same on every build.
use crate::culling::CullingCluster;
use trillion3d_math::aabb::{aabb_of, aabb_of_boxes, longest_axis};

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
pub fn half_area(min: [f64; 3], max: [f64; 3]) -> f64 {
    let [x, y, z] = [0, 1, 2].map(|a| max[a] - min[a]);
    x * y + y * z + z * x
}

/// Splits `slice` at its median on the axis whose two halves' boxes have the least surface, of
/// the three: the halves a view's frustum and occlusion tests reject most often. Each axis costs
/// one selection and one pass over the boxes, so a split stays linear. Returns that axis.
pub fn bisect_least_surface(
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
