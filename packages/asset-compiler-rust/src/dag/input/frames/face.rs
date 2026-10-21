//! What a rebuild of the frames (`frames.rs`) reads of each triangle: its normal, tangent and
//! binormal, and the weight of each of its corners.
//!
//! **Frame** (`face_frame`). Over its corners, measured in centimetres, a triangle's normal is the
//! unit cross of its edges from its first corner — nothing when its squared length is under the
//! square of the comparison threshold, or under the least normal float, or when the unit normal
//! lies within the threshold of nothing on every axis. Its tangent and binormal are the
//! directions its first texture set's u and v run along it: the edges weighed by the inverse of
//! its texture edges, or the edges themselves when those have no inverse; made unit, then
//! orthonormal around the normal (`orthonormal`); none when either is nearly nothing (1e-4 on
//! every axis) or not finite.
//!
//! **Weights** (`corner_weights`). A corner weighs its triangle's area times the angle its two
//! edges make there, the angle nothing when either edge is nothing (its squared length 1e-8 at
//! most), its cosine held within [-1, 1].
use crate::simplify::unit_or_same;
use trillion3d_math::scalar::acos::acos;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{add, dot, length, scale, squared_length, sub};

pub(super) type V3 = [f32; 3];
/// What counts as nothing, nearly nothing, and a parallel axis.
pub(super) const SMALL: f32 = 1e-8;
pub(super) const NEARLY: f32 = 1e-4;
const PARALLEL: f32 = 1e-5;

/// Whether every axis of `v` lies within `tolerance` of zero.
pub(super) fn nothing(v: V3, tolerance: f32) -> bool {
    v.iter().all(|x| x.abs() <= tolerance)
}

/// Whether `v` is finite and more than nothing at `tolerance`.
pub(super) fn something(v: V3, tolerance: f32) -> bool {
    v.iter().all(|x| x.is_finite()) && !nothing(v, tolerance)
}

/// `v` made unit, as it is when its squared length is 1, nothing under `tolerance`.
pub(super) fn unit_or_nothing(v: V3, tolerance: f32) -> V3 {
    let square = squared_length(v);
    if square == 1.0 {
        v
    } else if square < tolerance {
        [0.0; 3]
    } else {
        scale(v, 1.0 / square.sqrt())
    }
}

/// `x` and `y` made orthonormal around `z`: each less its part along `z`, one that was along it
/// replaced by `z` across the other, all three made unit.
fn orthonormal(x: V3, y: V3, z: V3) -> (V3, V3, V3) {
    let zz = dot(z, z);
    let mut x = sub(x, scale(z, dot(x, z) / zz));
    let mut y = sub(y, scale(z, dot(y, z) / zz));
    if squared_length(x) < PARALLEL * PARALLEL {
        x = cross(z, y);
    }
    if squared_length(y) < PARALLEL * PARALLEL {
        y = cross(z, x);
    }
    (unit_or_same(x), unit_or_same(y), unit_or_same(z))
}

/// A triangle's normal, tangent and binormal over its corners `p`, in centimetres, and texture
/// coordinates `uv`, its normal compared to nothing at `threshold` (the module's rule).
pub(super) fn face_frame(p: [V3; 3], uv: [[f32; 2]; 3], threshold: f32) -> [V3; 3] {
    let (d1, d2) = (sub(p[1], p[0]), sub(p[2], p[0]));
    let square = (threshold * threshold).max(f32::MIN_POSITIVE);
    let normal = unit_or_nothing(cross(d1, d2), square);
    if nothing(normal, threshold) {
        return [[0.0; 3]; 3];
    }
    let e1 = [uv[1][0] - uv[0][0], uv[1][1] - uv[0][1]];
    let e2 = [uv[2][0] - uv[0][0], uv[2][1] - uv[0][1]];
    let det = e1[0] * e2[1] - e1[1] * e2[0];
    let (tangent, binormal) = match det != 0.0 && det.is_finite() {
        true => (
            add(scale(d1, e2[1] / det), scale(d2, -e1[1] / det)),
            add(scale(d1, -e2[0] / det), scale(d2, e1[0] / det)),
        ),
        false => (d1, d2),
    };
    let tangent = unit_or_nothing(tangent, SMALL);
    let binormal = unit_or_nothing(binormal, SMALL);
    let (mut tangent, mut binormal, mut normal) = orthonormal(tangent, binormal, normal);
    if !something(tangent, NEARLY) || !something(binormal, NEARLY) {
        (tangent, binormal) = ([0.0; 3], [0.0; 3]);
    }
    if !something(normal, NEARLY) {
        normal = [0.0; 3];
    }
    [normal, tangent, binormal].map(|v| unit_or_nothing(v, SMALL))
}

/// The weight of each corner of the triangle over `p`, in centimetres (the module's rule).
pub(super) fn corner_weights(p: [V3; 3]) -> [f32; 3] {
    let area = length(cross(sub(p[1], p[0]), sub(p[2], p[0]))) / 2.0;
    let unit = |v: V3| {
        let square = squared_length(v);
        (square > SMALL).then(|| scale(v, 1.0 / square.sqrt()))
    };
    std::array::from_fn(|k| {
        let edges = (
            unit(sub(p[(k + 1) % 3], p[k])),
            unit(sub(p[(k + 2) % 3], p[k])),
        );
        match edges {
            // The arc cosine of a cosine held within [-1, 1], by the one fdlibm arc cosine: the
            // same bits on every host.
            (Some(e1), Some(e2)) => area * acos(f64::from(dot(e1, e2).clamp(-1.0, 1.0))) as f32,
            _ => 0.0,
        }
    })
}
