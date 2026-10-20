//! The octahedral map of the unit sphere onto a square: a direction projected onto the octahedron
//! `|x| + |y| + |z| = 1`, its lower half folded over the upper one, `+Z` the upper pole
//! (`project`, `unproject`; the shaders' `octEncode`, `octDecode`). Its users:
//!
//! - `oct_encode`, `oct_decode`: a normal on two bytes and back, in `f32` — the page format's;
//! - `octahedral_encode`, `octahedral_decode`: a direction on `[-1, 1]²` (the grid `[0, 1]²` back),
//!   in `f64` — the impostor atlas, `+Y` its pole: the same map with `y` and `z` swapped, or the
//!   upper hemi-octahedron.

use crate::real::Real;
use crate::vec3::{divide, unit_or_itself};
use crate::vecn::{length, scale};

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

/// `v` on the octahedron, `(x, y) / (|x| + |y| + |z|)`, the lower half (`z < 0`) folded: the one
/// map, `+Z` its pole. A zero sum is replaced by 1 (the zenith `(0, 0)` of a zero direction), as
/// the shader's `octEncode` does.
#[inline]
fn project<T: Real + PartialOrd>([x, y, z]: [T; 3]) -> [T; 2] {
    let sum = x.abs() + y.abs() + z.abs();
    let sum = if sum <= T::ZERO { T::ONE } else { sum };
    let p = [x / sum, y / sum];
    if z < T::ZERO {
        fold(p)
    } else {
        p
    }
}

/// `project`'s point `e` back on the octahedron, not made unit: `z = 1 − |x| − |y|`, the lower
/// half unfolded.
#[inline]
fn unproject<T: Real + PartialOrd>(e: [T; 2]) -> [T; 3] {
    let z = T::ONE - e[0].abs() - e[1].abs();
    let [x, y] = if z < T::ZERO { fold(e) } else { e };
    [x, y, z]
}

/// The lower half folded over the upper one: each axis `1 − |other|`, on its own side, `+` at zero
/// (`sign(0) = 0` would send the direction to the wrong face). One rounding, in the caller's
/// precision: the shaders' `octFold`, for the four maps here.
#[inline]
fn fold<T: Real + PartialOrd>([a, b]: [T; 2]) -> [T; 2] {
    let side = |x: T| if x < T::ZERO { -T::ONE } else { T::ONE };
    [(T::ONE - b.abs()) * side(a), (T::ONE - a.abs()) * side(b)]
}

/// Direction `d` to the plane `[-1, 1]²`, `(x, z)` on the octahedron: the full octahedron
/// (`project` with `y` and `z` swapped), or the upper hemi-octahedron (`hemi`), turned an eighth, where a direction
/// below the horizon is first flattened onto it. A zero direction on the upper half gives `(0, 0)`.
pub fn octahedral_encode(d: [f64; 3], hemi: bool) -> [f64; 2] {
    if hemi {
        let d = [d[0], d[1].max(0.0), d[2]];
        let norm = d[0].abs() + d[1] + d[2].abs();
        if norm <= 0.0 {
            return [0.0, 0.0];
        }
        let o = scale(d, 1.0 / norm);
        return [o[0] + o[2], o[2] - o[0]];
    }
    project([d[0], d[2], d[1]])
}

/// Grid coordinates `f ∈ [0, 1]²` back to a unit direction (`unit_or_itself`), the inverse of
/// `octahedral_encode` read through `f = uv·½ + ½`.
pub fn octahedral_decode(f: [f64; 2], hemi: bool) -> [f64; 3] {
    if hemi {
        let (x, z) = (f[0] - f[1], f[0] + f[1] - 1.0);
        return unit_or_itself([x, 1.0 - x.abs() - z.abs(), z]);
    }
    let [x, z, y] = unproject([f[0] * 2.0 - 1.0, f[1] * 2.0 - 1.0]);
    unit_or_itself([x, y, z])
}

#[cfg(test)]
#[path = "octahedral_tests.rs"]
mod tests;
