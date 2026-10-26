//! The octahedral map of the unit sphere onto a square: a direction projected onto the octahedron
//! `|x| + |y| + |z| = 1`, its lower half folded over the upper one, `+Z` the upper pole
//! (`project`, `unproject`; the shaders' `octEncode`, `octDecode`). Its one user:
//!
//! - `oct_encode`, `oct_decode`: a normal on two bytes and back, in `f32` — a voxel's.

use crate::vector::vec3::divide;
use crate::vector::vecn::length;

/// `2 / 255` as the nearest `f32`: an octahedral byte to `[-1, 1]`.
pub const OCT_SCALE: f32 = 2.0 / 255.0;

/// Octahedral encoding of a normal into two bytes, `x` low and `y` high. Of the four roundings
/// of the projected point, the one that decodes closest to the source is kept: the best of the four
/// neighbouring cells, not the plain rounding. A zero or non-finite normal takes `+z`.
pub fn oct_encode(normal: [f32; 3]) -> u32 {
    let [x, y, z] = normal;
    let sum = x.abs() + y.abs() + z.abs();
    if sum == 0.0 || !sum.is_finite() {
        return 128 | (128 << 8);
    }
    let [px, py] = project(normal);
    let cell = |v: f32| ((v + 1.0) * 127.5).floor().clamp(0.0, 254.0) as u32;
    let (bx, by) = (cell(px), cell(py));
    let unit = divide(normal, length(normal));
    let mut best = (f32::INFINITY, 0u32);
    for candidate in [bx, bx + 1]
        .into_iter()
        .flat_map(|qx| [qx | (by << 8), qx | ((by + 1) << 8)])
    {
        let [dx, dy, dz] = oct_decode(candidate);
        let dot = dx * unit[0] + dy * unit[1] + dz * unit[2];
        let error = 1.0 - dot;
        if error < best.0 {
            best = (error, candidate);
        }
    }
    best.1
}

/// Two octahedral bytes (`x` low, `y` high) back to a unit vector: each byte times `OCT_SCALE`
/// less one, the lower half unfolded, divided by `√((x² + y²) + z²)`.
pub fn oct_decode(q: u32) -> [f32; 3] {
    let v = unproject([
        (q & 255) as f32 * OCT_SCALE - 1.0,
        ((q >> 8) & 255) as f32 * OCT_SCALE - 1.0,
    ]);
    divide(v, length(v))
}

/// `v` on the octahedron, `(x, y) / (|x| + |y| + |z|)`, the lower half (`z < 0`) folded. A zero
/// sum is replaced by 1 (the zenith `(0, 0)` of a zero direction), as the shader's `octEncode`
/// does.
#[inline]
pub fn project([x, y, z]: [f32; 3]) -> [f32; 2] {
    let sum = x.abs() + y.abs() + z.abs();
    let sum = if sum <= 0.0 { 1.0 } else { sum };
    let p = [x / sum, y / sum];
    if z < 0.0 {
        fold(p)
    } else {
        p
    }
}

/// `project`'s point `e` back on the octahedron, not made unit: `z = 1 − |x| − |y|`, the lower
/// half unfolded.
#[inline]
fn unproject(e: [f32; 2]) -> [f32; 3] {
    let z = 1.0 - e[0].abs() - e[1].abs();
    let [x, y] = if z < 0.0 { fold(e) } else { e };
    [x, y, z]
}

/// `project`'s point `e` back on the octahedron by the page codec's unfold, not made unit:
/// `z = (1 − |x|) − |y|`, and below the equator each axis moved by what `z` lacks of zero (at most
/// 1), `e − lack` for a non-negative axis, `e + lack` for a negative one. `unproject` folds instead;
/// the two differ in the last bits.
#[inline]
pub fn unproject_unfolded([x, y]: [f32; 2]) -> [f32; 3] {
    let z = (1.0 - x.abs()) - y.abs();
    let lack = if z < 0.0 { (-z).min(1.0) } else { 0.0 };
    let unfold = |v: f32| if v >= 0.0 { v - lack } else { v + lack };
    [unfold(x), unfold(y), z]
}

/// The lower half folded over the upper one: each axis `1 − |other|`, on its own side, `+` at zero
/// (`sign(0) = 0` would send the direction to the wrong face). One rounding: the shaders'
/// `octFold`.
#[inline]
fn fold([a, b]: [f32; 2]) -> [f32; 2] {
    let side = |x: f32| if x < 0.0 { -1.0 } else { 1.0 };
    [(1.0 - b.abs()) * side(a), (1.0 - a.abs()) * side(b)]
}

#[cfg(test)]
mod tests;
