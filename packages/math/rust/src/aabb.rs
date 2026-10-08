//! Axis-aligned boxes, as a low and a high corner, grown by points and by boxes, and crossed by a
//! ray: every compiler stage that bounds geometry grows its boxes here, with the same bits on every
//! machine.

use crate::js::{lower, lower_f32, upper, upper_f32};

/// Extends bounding box by another box, axis by axis in axis order, by `lower` and `upper`: NaN
/// in the read box leaves the bound as is, NaN in the bound is replaced by the coordinate. Min
/// corner compared only to min corner and max to max corner.
#[inline]
pub fn merge_aabb<const N: usize>(
    low: &mut [f64; N],
    high: &mut [f64; N],
    other_low: [f64; N],
    other_high: [f64; N],
) {
    for axis in 0..N {
        low[axis] = lower(low[axis], other_low[axis]);
        high[axis] = upper(high[axis], other_high[axis]);
    }
}

/// Extends bounding box by point: box reduced to point.
#[inline]
pub fn extend_aabb<const N: usize>(low: &mut [f64; N], high: &mut [f64; N], point: [f64; N]) {
    merge_aabb(low, high, point, point);
}

/// Same box in single precision: site accumulating `f32` does not go through `f64`.
#[inline]
pub fn extend_aabb_f32<const N: usize>(low: &mut [f32; N], high: &mut [f32; N], point: [f32; N]) {
    for axis in 0..N {
        low[axis] = lower_f32(low[axis], point[axis]);
        high[axis] = upper_f32(high[axis], point[axis]);
    }
}

/// The box of `points`: low bounds at `+∞` and high at `−∞` when there is none, each point taken
/// in order by `extend_aabb`.
#[inline]
pub fn aabb_of<const N: usize>(points: impl IntoIterator<Item = [f64; N]>) -> ([f64; N], [f64; N]) {
    let (mut low, mut high) = ([f64::INFINITY; N], [f64::NEG_INFINITY; N]);
    for point in points {
        extend_aabb(&mut low, &mut high, point);
    }
    (low, high)
}

/// `aabb_of` in single precision, by `extend_aabb_f32`.
#[inline]
pub fn aabb_of_f32<const N: usize>(
    points: impl IntoIterator<Item = [f32; N]>,
) -> ([f32; N], [f32; N]) {
    let (mut low, mut high) = ([f32::INFINITY; N], [f32::NEG_INFINITY; N]);
    for point in points {
        extend_aabb_f32(&mut low, &mut high, point);
    }
    (low, high)
}

/// The box of `boxes`, each merged in order by `merge_aabb`: low bounds at `+∞` and high at `−∞`
/// when there is none.
#[inline]
pub fn aabb_of_boxes<const N: usize>(
    boxes: impl IntoIterator<Item = ([f64; N], [f64; N])>,
) -> ([f64; N], [f64; N]) {
    let (mut low, mut high) = ([f64::INFINITY; N], [f64::NEG_INFINITY; N]);
    for (other_low, other_high) in boxes {
        merge_aabb(&mut low, &mut high, other_low, other_high);
    }
    (low, high)
}

/// A box laid out flat, the low corner then the high one, `[x, y, z, X, Y, Z]`, no point is in yet.
pub const EMPTY_FLAT: [f64; 6] = [
    f64::INFINITY,
    f64::INFINITY,
    f64::INFINITY,
    f64::NEG_INFINITY,
    f64::NEG_INFINITY,
    f64::NEG_INFINITY,
];

/// `merge_aabb` of boxes laid out flat (`EMPTY_FLAT`).
#[inline]
pub fn grow_flat(into: &mut [f64; 6], other: &[f64; 6]) {
    for axis in 0..3 {
        into[axis] = lower(into[axis], other[axis]);
        into[axis + 3] = upper(into[axis + 3], other[axis + 3]);
    }
}

/// `extend_aabb` of a box laid out flat (`EMPTY_FLAT`): the box reduced to the point.
#[inline]
pub fn extend_flat(into: &mut [f64; 6], point: [f64; 3]) {
    let [x, y, z] = point;
    grow_flat(into, &[x, y, z, x, y, z]);
}

/// The centre of the box, `(low + high) · 0.5` axis by axis.
#[inline]
pub fn centre<const N: usize>(low: [f64; N], high: [f64; N]) -> [f64; N] {
    core::array::from_fn(|axis| (low[axis] + high[axis]) * 0.5)
}

/// Corner `index` of the box: on each axis `a`, the high bound when bit `a` of `index` is set, the
/// low one otherwise. `0` is the low corner, `2ᴺ − 1` the high one.
#[inline]
pub fn corner<const N: usize>(low: [f64; N], high: [f64; N], index: usize) -> [f64; N] {
    core::array::from_fn(|axis| {
        if index & (1 << axis) == 0 {
            low[axis]
        } else {
            high[axis]
        }
    })
}

/// The eight corners of a box in space, `corner` 0 to 7.
#[inline]
pub fn corners(low: [f64; 3], high: [f64; 3]) -> [[f64; 3]; 8] {
    core::array::from_fn(|index| corner(low, high, index))
}

/// The longest side of the box, `high − low` axis by axis, from `0.0` by `f64::max` in axis order:
/// a NaN side is passed over, and an empty box gives `0.0`.
#[inline]
pub fn longest_side<const N: usize>(low: [f64; N], high: [f64; N]) -> f64 {
    (0..N).fold(0.0f64, |best, axis| best.max(high[axis] - low[axis]))
}

/// The axis along which the box is widest: the first on a tie, by a strict `>`, so a NaN side
/// never changes the choice.
#[inline]
pub fn longest_axis<const N: usize>(low: &[f64; N], high: &[f64; N]) -> usize {
    let mut axis = 0;
    for a in 1..N {
        if high[a] - low[a] > high[axis] - low[axis] {
            axis = a;
        }
    }
    axis
}

/// The length of the box's diagonal, `vecn::length(high − low)`: the root of its squared sides
/// summed in axis order.
#[inline]
pub fn diagonal<const N: usize>(low: [f64; N], high: [f64; N]) -> f64 {
    crate::vecn::length(crate::vecn::sub(high, low))
}

/// Whether the ray from `origin`, its direction's reciprocal `inverse`, crosses the box `[low,
/// high]` between 0 and `limit`: the slab test, axis by axis in axis order, each side's distance
/// `(bound − origin) · inverse`, the entry raised from 0 by `f64::max` of the nearer and the exit
/// lowered from `limit` by `f64::min` of the farther; a hit when the entry is not past the exit. A
/// NaN distance (`0 · ∞`, a zero component of the direction against a bound through the origin) is
/// passed over by `min` and `max`, the other bound's distance then both the nearer and the farther.
#[inline]
pub fn ray_aabb(
    low: [f64; 3],
    high: [f64; 3],
    origin: [f64; 3],
    inverse: [f64; 3],
    limit: f64,
) -> bool {
    let mut entry = 0.0f64;
    let mut exit = limit;
    for axis in 0..3 {
        let near = (low[axis] - origin[axis]) * inverse[axis];
        let far = (high[axis] - origin[axis]) * inverse[axis];
        entry = entry.max(near.min(far));
        exit = exit.min(near.max(far));
    }
    entry <= exit
}

#[cfg(test)]
#[path = "aabb_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "aabb_ray_tests.rs"]
mod ray_tests;

#[cfg(test)]
#[path = "aabb_extent_tests.rs"]
mod extent_tests;
