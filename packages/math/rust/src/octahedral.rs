//! Octahedral maps of the unit sphere onto a square: a direction projected onto the octahedron
//! `|x| + |y| + |z| = 1`, its lower half folded over the upper one. Two maps, kept apart:
//!
//! - `oct_encode`, `oct_decode`: a normal on two bytes and back, in `f32`, `+Z` the upper pole —
//!   the page format's normals;
//! - `octahedral_encode`, `octahedral_decode`: a direction on `[-1, 1]²` (the grid `[0, 1]²` back),
//!   in `f64`, `+Y` the upper pole, the full sphere or its upper half — the impostor atlas.

use crate::vec3::{length_f32, scale, unit_or_itself};

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
    let (px, py) = (x / sum, y / sum);
    let (px, py) = if z < 0.0 {
        (
            (1.0 - py.abs()) * if px >= 0.0 { 1.0 } else { -1.0 },
            (1.0 - px.abs()) * if py >= 0.0 { 1.0 } else { -1.0 },
        )
    } else {
        (px, py)
    };
    let cell = |v: f32| ((v + 1.0) * 127.5).floor().clamp(0.0, 254.0) as u32;
    let (bx, by) = (cell(px), cell(py));
    let length = length_f32(normal);
    let unit = [x / length, y / length, z / length];
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
    let x = (q & 255) as f32 * OCT_SCALE - 1.0;
    let y = ((q >> 8) & 255) as f32 * OCT_SCALE - 1.0;
    let z = 1.0 - x.abs() - y.abs();
    let (x, y) = if z < 0.0 {
        (
            (1.0 - y.abs()) * if x >= 0.0 { 1.0 } else { -1.0 },
            (1.0 - x.abs()) * if y >= 0.0 { 1.0 } else { -1.0 },
        )
    } else {
        (x, y)
    };
    let length = length_f32([x, y, z]);
    [x / length, y / length, z / length]
}

/// `±1`, never `0`: the fold of the lower half needs a side even on an axis, where `sign(0) = 0`
/// would send the direction to the wrong face.
#[inline]
fn side(x: f64) -> f64 {
    if x < 0.0 {
        -1.0
    } else {
        1.0
    }
}

/// Direction `d` to the plane `[-1, 1]²`, `(x, z)` on the octahedron: the full octahedron, its
/// lower half folded, or the upper hemi-octahedron (`hemi`), turned an eighth, where a direction
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
    let o = scale(d, 1.0 / (d[0].abs() + d[1].abs() + d[2].abs()));
    if o[1] < 0.0 {
        return [
            side(o[0]) * (1.0 - o[2].abs()),
            side(o[2]) * (1.0 - o[0].abs()),
        ];
    }
    [o[0], o[2]]
}

/// Grid coordinates `f ∈ [0, 1]²` back to a unit direction (`unit_or_itself`), the inverse of
/// `octahedral_encode` read through `f = uv·½ + ½`.
pub fn octahedral_decode(f: [f64; 2], hemi: bool) -> [f64; 3] {
    if hemi {
        let (x, z) = (f[0] - f[1], f[0] + f[1] - 1.0);
        return unit_or_itself([x, 1.0 - x.abs() - z.abs(), z]);
    }
    let (u, v) = (f[0] * 2.0 - 1.0, f[1] * 2.0 - 1.0);
    let y = 1.0 - u.abs() - v.abs();
    if y < 0.0 {
        return unit_or_itself([side(u) * (1.0 - v.abs()), y, side(v) * (1.0 - u.abs())]);
    }
    unit_or_itself([u, y, v])
}

#[cfg(test)]
#[path = "octahedral_tests.rs"]
mod tests;
