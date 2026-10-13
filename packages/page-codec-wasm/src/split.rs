//! THE MEDIAN SPLIT of a group of ids by their centres, one for every tree built over boxed things:
//! the culling hierarchy (`culling.rs`), the triangle clusters (`clusters/spatial.rs`), the proxy's
//! BVH (`proxy/bvh.rs`) and the DAG's groups (`asset-compiler-rust/src/dag/groups.rs`).
//! A split is a selection, linear in the group, never a sort; a caller that reads a half in order
//! sorts it (`sort_along`). Ties break by identifier, so a tree is the same on every build.
use trillion3d_math::aabb::{aabb_of, aabb_of_boxes, longest_axis};
use trillion3d_math::vecn::distance2;

/// The order of two ids by their centres' coordinate on `axis` (`total_cmp`, so NaN has a place),
/// then by identifier: two coincident centres keep the same order from build to build.
fn along(centres: &[[f64; 3]], axis: usize) -> impl Fn(&usize, &usize) -> std::cmp::Ordering + '_ {
    move |&x, &y| {
        centres[x][axis]
            .total_cmp(&centres[y][axis])
            .then(x.cmp(&y))
    }
}

/// Puts the id of rank `at` on `axis` at `at` by selection, in linear time: every id before it
/// comes first in the order of `along`, every one after it later, each side in no order.
pub fn select_at(slice: &mut [usize], centres: &[[f64; 3]], axis: usize, at: usize) {
    if at < slice.len() && slice.len() > 1 {
        slice.select_nth_unstable_by(at, along(centres, axis));
    }
}

/// Sorts `slice` in the order of `along` on `axis`.
pub fn sort_along(slice: &mut [usize], centres: &[[f64; 3]], axis: usize) {
    slice.sort_unstable_by(along(centres, axis));
}

/// Splits a group of ids in two spatial halves on the widest axis of their centres: the median
/// falls on `slice.len() / 2` (`select_at`). Returns that axis; a caller that reads the halves
/// in order sorts them on it (`sort_along`), which gives the order a full sort gives.
pub fn bisect_centres(slice: &mut [usize], centres: &[[f64; 3]]) -> usize {
    let (low, high) = aabb_of(slice.iter().map(|&id| centres[id]));
    let axis = longest_axis(&low, &high);
    select_at(slice, centres, axis, slice.len() / 2);
    axis
}

/// Splits `slice` at rank `at` on the axis of the least cost, of the three: each side's count times
/// the squared diagonal of its boxes (`bounds` of an id; `distance2` of the corners). A side's
/// squared diagonal is the square of the sphere every cull and every shadow page draws it with, so
/// the cost is what a view pays to test what lies below; on a flat patch, where a surface ties on
/// both axes, it still cuts the long side first, so the sides stay square. Each axis costs one
/// selection and one pass over the boxes, so a split stays linear. Returns that axis.
pub fn bisect_least_cost(
    slice: &mut [usize],
    centres: &[[f64; 3]],
    bounds: impl Fn(usize) -> ([f64; 3], [f64; 3]),
    at: usize,
) -> usize {
    let boxes = |part: &[usize]| aabb_of_boxes(part.iter().map(|&id| bounds(id)));
    let mut best: Option<(f64, usize)> = None;
    for axis in 0..3 {
        select_at(slice, centres, axis, at);
        let (low, high) = boxes(&slice[..at]);
        let (low1, high1) = boxes(&slice[at..]);
        let (left, right) = (at as f64, (slice.len() - at) as f64);
        let cost = left * distance2(high, low) + right * distance2(high1, low1);
        if best.is_none_or(|(least, _)| cost < least) {
            best = Some((cost, axis));
        }
    }
    let axis = best.map_or(0, |(_, axis)| axis);
    if axis != 2 {
        select_at(slice, centres, axis, at);
    }
    axis
}
