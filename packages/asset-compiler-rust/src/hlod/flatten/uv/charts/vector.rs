//! Single-precision plane and space vectors as the chart builder rounds them. The sum, difference,
//! scale, dot product and length are `vecn`'s, the space cross product `vec3`'s; what lives here
//! is what this builder rounds its own way:
//!
//! - `least` and `most` (`uv::extremes`) keep the first argument only on a strict comparison, so a
//!   NaN in either gives the second, the order every comparison of the builder is made in;
//! - `unit` multiplies by the reciprocal of the length (one rounding more than a division);
//! - `near` compares relative to the larger magnitude (at least one), `near3` axis by axis in
//!   absolute terms;
//! - `Frame` is a chart's tangent, bitangent and normal, the tangent taken from the axis the
//!   normal leans on least.
pub(super) use crate::hlod::flatten::uv::extremes::{least, most};
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, length, scale, sub};

pub(super) type Vec2 = [f32; 2];
pub(super) type Vec3 = [f32; 3];

/// The tolerance of the builder's geometric tests: coplanarity, hull points, grid steps.
pub(super) const EPSILON: f32 = 0.0001;
/// The least area a triangle, flat or mapped, counts as having.
pub(super) const AREA_EPSILON: f32 = f32::EPSILON;
/// The tolerance a unit vector's length and two normals are compared with.
pub(super) const NORMAL_EPSILON: f32 = 0.001;
/// The margin of the boundary crossing tests: the single-precision machine epsilon.
pub(super) const MESH_EPSILON: f32 = f32::EPSILON;

/// `least` axis by axis.
#[inline]
pub(super) fn least2(a: Vec2, b: Vec2) -> Vec2 {
    [least(a[0], b[0]), least(a[1], b[1])]
}

/// `most` axis by axis.
#[inline]
pub(super) fn most2(a: Vec2, b: Vec2) -> Vec2 {
    [most(a[0], b[0]), most(a[1], b[1])]
}

/// `x` raised to `low`, then lowered to `high`.
#[inline]
pub(super) fn clamp_to(x: f32, low: f32, high: f32) -> f32 {
    least(most(x, low), high)
}

/// Whether `a` and `b` differ by at most `epsilon` times the larger of one and their magnitudes.
#[inline]
pub(super) fn near(a: f32, b: f32, epsilon: f32) -> bool {
    (a - b).abs() <= epsilon * most(1.0, most(a.abs(), b.abs()))
}

/// `near` on both axes.
#[inline]
pub(super) fn near2(a: Vec2, b: Vec2, epsilon: f32) -> bool {
    near(a[0], b[0], epsilon) && near(a[1], b[1], epsilon)
}

/// Whether `a` and `b` differ by at most `epsilon` on every axis.
#[inline]
pub(super) fn near3(a: Vec3, b: Vec3, epsilon: f32) -> bool {
    (a[0] - b[0]).abs() <= epsilon
        && (a[1] - b[1]).abs() <= epsilon
        && (a[2] - b[2]).abs() <= epsilon
}

/// `v` times the reciprocal of its length; unguarded, a zero vector gives NaN.
#[inline]
pub(super) fn unit<const N: usize>(v: [f32; N]) -> [f32; N] {
    scale(v, 1.0 / length(v))
}

/// The plane `unit` when the length is positive, `fallback` otherwise (a NaN length included);
/// in space, `vec3::unit_where` rounds the same way.
#[inline]
pub(super) fn unit_or(v: Vec2, fallback: Vec2) -> Vec2 {
    let l = length(v);
    if l > 0.0 {
        scale(v, 1.0 / l)
    } else {
        fallback
    }
}

/// Whether `v`'s length is one within `NORMAL_EPSILON`.
#[inline]
pub(super) fn is_unit(v: Vec3) -> bool {
    near(length(v), 1.0, NORMAL_EPSILON)
}

/// `−v`.
#[inline]
pub(super) fn negate(v: Vec3) -> Vec3 {
    [-v[0], -v[1], -v[2]]
}

/// Half the signed area of the plane triangle `a, b, c`, its corners taken relative to `c` first so
/// a small triangle far from the origin keeps its digits.
#[inline]
pub(super) fn signed_half_area(a: Vec2, b: Vec2, c: Vec2) -> f32 {
    let (u, v) = (sub(a, c), sub(b, c));
    (u[0] * v[1] - u[1] * v[0]) * 0.5
}

/// Half the signed area of a texture triangle as its quality tests read it, from `a`, the `y`
/// differences first: positive for a clockwise triangle, the negation, bit for bit, of the
/// `x`-first form.
#[inline]
pub(super) fn uv_half_area(a: Vec2, b: Vec2, c: Vec2) -> f32 {
    ((b[1] - a[1]) * (c[0] - a[0]) - (c[1] - a[1]) * (b[0] - a[0])) * 0.5
}

/// Half the area of the space triangle `a, b, c`.
#[inline]
pub(super) fn space_area(a: Vec3, b: Vec3, c: Vec3) -> f32 {
    length(cross(sub(b, a), sub(c, a))) * 0.5
}

/// Whether the segments `a1 a2` and `b1 b2` cross strictly inside both: each crossing parameter
/// between `epsilon` and `1 − epsilon`, parallel segments (a determinant `near` zero) never.
pub(super) fn segments_cross(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2, epsilon: f32) -> bool {
    let (v0, v1) = (sub(a2, a1), sub(b2, b1));
    let denominator = -v1[0] * v0[1] + v0[0] * v1[1];
    if near(denominator, 0.0, epsilon) {
        return false;
    }
    let s = (-v0[1] * (a1[0] - b1[0]) + v0[0] * (a1[1] - b1[1])) / denominator;
    if s > epsilon && s < 1.0 - epsilon {
        let t = (v1[0] * (a1[1] - b1[1]) - v1[1] * (a1[0] - b1[0])) / denominator;
        return t > epsilon && t < 1.0 - epsilon;
    }
    false
}

/// The least and greatest of `points` axis by axis (`least2`, `most2`), from `f32::MAX` and
/// `−f32::MAX`.
pub(super) fn bounds2(points: impl IntoIterator<Item = Vec2>) -> (Vec2, Vec2) {
    (points.into_iter()).fold(([f32::MAX; 2], [-f32::MAX; 2]), |(low, high), p| {
        (least2(low, p), most2(high, p))
    })
}

/// A chart's frame: the plane it is projected on (tangent, bitangent) and its normal.
#[derive(Clone, Copy, Default)]
pub(super) struct Frame {
    pub(super) tangent: Vec3,
    pub(super) bitangent: Vec3,
    pub(super) normal: Vec3,
}

impl Frame {
    /// The frame of `normal` and `tangent`, the bitangent their cross product.
    pub(super) fn new(normal: Vec3, tangent: Vec3) -> Frame {
        Frame {
            tangent,
            bitangent: cross(normal, tangent),
            normal,
        }
    }

    /// The frame around the unit `normal`: the axis it leans on least (the last of equals), made
    /// square to it, as the tangent.
    pub(super) fn around(normal: Vec3) -> Frame {
        let axis = if normal[0].abs() < normal[1].abs() && normal[0].abs() < normal[2].abs() {
            [1.0, 0.0, 0.0]
        } else if normal[1].abs() < normal[2].abs() {
            [0.0, 1.0, 0.0]
        } else {
            [0.0, 0.0, 1.0]
        };
        Frame::new(normal, unit(sub(axis, scale(normal, dot(normal, axis)))))
    }

    /// `p` projected on the frame's plane.
    #[inline]
    pub(super) fn project(&self, p: Vec3) -> Vec2 {
        [dot(self.tangent, p), dot(self.bitangent, p)]
    }
}
