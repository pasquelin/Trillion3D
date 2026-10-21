//! THE MEDIAN SPLIT of a group of ids by their centres, on the axis of least cost, one for every
//! median tree built over boxed things: the proxy's BVH (`proxy/bvh.rs`) and the world's cells
//! (`asset-compiler-rust/src/compiler/tables/partition/split.rs`); the culling hierarchy sorts its
//! parts as the reference does (`culling/tree.rs`).
//! A split is a selection, linear in the group, never a sort: each half is in no order. Ties break
//! by identifier, so a tree is the same on every build.
use trillion3d_math::geometry::aabb::{aabb_of, aabb_of_boxes};
use trillion3d_math::geometry::triangle::centroid;
use trillion3d_math::vector::vecn::distance2;

/// Triangle centroids and boxes (`centres_and_boxes`).
pub type Boxed = (Vec<[f64; 3]>, Vec<([f64; 3], [f64; 3])>);

/// Each triangle's centroid and box, of its three corners: what the median splits, and what its
/// cost weighs.
pub fn centres_and_boxes(triangles: impl Iterator<Item = [[f64; 3]; 3]>) -> Boxed {
    triangles.map(|t| (centroid(t), aabb_of(t))).unzip()
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

/// Puts the id of rank `at` on `axis` at `at` by selection, in linear time: every id before it
/// comes first in the order of `along`, every one after it later, each side in no order.
pub fn select_at(slice: &mut [usize], centres: &[[f64; 3]], axis: usize, at: usize) {
    if at < slice.len() && slice.len() > 1 {
        slice.select_nth_unstable_by(at, along(centres, axis));
    }
}

/// Sorts `slice` in the order of `along` on `axis`: the order the tests read a split's halves in.
#[cfg(test)]
pub(crate) fn sort_along(slice: &mut [usize], centres: &[[f64; 3]], axis: usize) {
    slice.sort_unstable_by(along(centres, axis));
}

/// The cost of a split into two sides, each a count and the box of its members: each side's count
/// times the squared diagonal of its box, summed left then right.
pub fn split_cost(
    (left, (low, high)): (usize, ([f64; 3], [f64; 3])),
    (right, (low1, high1)): (usize, ([f64; 3], [f64; 3])),
) -> f64 {
    left as f64 * distance2(high, low) + right as f64 * distance2(high1, low1)
}

/// Splits `slice` at rank `at` on the axis of the least cost, of the three (`split_cost`, over the
/// boxes `bounds` gives each id). A side's squared diagonal is the square of the sphere every cull
/// and every shadow page draws it with, so the cost is what a view pays to test what lies below; on
/// a flat patch, where a surface ties on both axes, it still cuts the long side first, so the sides
/// stay square. Each axis costs one selection and one pass over the boxes, so a split stays linear.
/// Returns that axis.
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
        let cost = split_cost(
            (at, boxes(&slice[..at])),
            (slice.len() - at, boxes(&slice[at..])),
        );
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
