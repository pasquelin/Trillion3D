//! The double-precision plane geometry of the window propagation: distances, a point laid in an
//! edge's frame, the crossing of two lines, the angle at a corner.
use trillion3d_math::scalar::acos::acos;
use trillion3d_math::vector::vec2;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, length, sub};

/// The distance between two points, in the plane or in space.
pub(super) fn distance<const N: usize>(a: [f64; N], b: [f64; N]) -> f64 {
    length(sub(a, b))
}

/// The square root of `x`, zero below zero.
pub(super) fn root_min0(x: f64) -> f64 {
    (if x < 0.0 { 0.0 } else { x }).sqrt()
}

/// `p` in the plane frame whose origin is `origin` and whose x axis points to `along`: its
/// projection on the axis, and its distance from it, never negative.
pub(super) fn into_frame_3d(origin: [f64; 3], along: [f64; 3], p: [f64; 3]) -> [f64; 2] {
    let v = sub(p, origin);
    let q = sub(along, origin);
    let reach = length(q);
    [dot(v, q) / reach, length(cross(v, q)) / reach]
}

/// `into_frame_3d` for plane points.
pub(super) fn into_frame_2d(origin: [f64; 2], along: [f64; 2], p: [f64; 2]) -> [f64; 2] {
    let v = sub(p, origin);
    let q = sub(along, origin);
    let reach = length(q);
    [dot(v, q) / reach, vec2::cross(v, q).abs() / reach]
}

/// Where the line through `a0 a1` meets the line through `b0 b1`, and whether that point lies on
/// the segment `a0 a1`; nearly parallel lines meet at the largest float on both axes.
pub(super) fn line_crossing(
    a0: [f64; 2],
    a1: [f64; 2],
    b0: [f64; 2],
    b1: [f64; 2],
) -> ([f64; 2], bool) {
    let d = (a0[1] - a1[1]) * (b0[0] - b1[0]) - (a0[0] - a1[0]) * (b0[1] - b1[1]);
    if d.abs() < f32::EPSILON as f64 {
        return ([f32::MAX as f64; 2], false);
    }
    let t =
        (-b0[1] * b1[0] + a0[1] * (-b0[0] + b1[0]) + a0[0] * (b0[1] - b1[1]) + b0[0] * b1[1]) / -d;
    let point = [(a1[0] - a0[0]) * t + a0[0], (a1[1] - a0[1]) * t + a0[1]];
    (point, (0.0..=1.0).contains(&t))
}

/// The angle at `common` between the directions to `a` and `b`.
pub(super) fn angle_between(common: [f64; 3], a: [f64; 3], b: [f64; 3]) -> f64 {
    let p = sub(a, common);
    let q = sub(b, common);
    acos(dot(p, q) / (length(p) * length(q)))
}
