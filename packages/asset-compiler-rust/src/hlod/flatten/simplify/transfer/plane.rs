//! A triangle of the atlas's plane as the raster reads it, double precision: its box, a point's
//! scaled distances to its three edges' lines — positive on the inside of a counter-clockwise
//! triangle, each in units of its edge's length (`scaled`) — and the barycentric weights they make
//! (`weights`), and the point of its edges nearest a point (`nearest`).
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// A point of the plane.
pub(super) type Point = [f64; 2];

/// The box of triangle `t`: its low corner, then its high corner, each a running least or greatest
/// from the largest values.
pub(super) fn bounds(t: [Point; 3]) -> [Point; 2] {
    let (mut low, mut high) = ([f64::MAX; 2], [f64::MIN; 2]);
    for p in t {
        for k in 0..2 {
            low[k] = if low[k] <= p[k] { low[k] } else { p[k] };
            high[k] = if high[k] >= p[k] { high[k] } else { p[k] };
        }
    }
    [low, high]
}

/// The scaled distance of `p` to the line from `a` to `b`: positive on its left.
fn line(a: Point, b: Point, p: Point) -> f64 {
    (p[0] - a[0]) * (a[1] - b[1]) + (b[0] - a[0]) * (p[1] - a[1])
}

/// The scaled distances of `p` to the lines of triangle `t`'s edges opposite each corner.
pub(super) fn scaled(t: [Point; 3], p: Point) -> [f64; 3] {
    [
        line(t[1], t[2], p),
        line(t[2], t[0], p),
        line(t[0], t[1], p),
    ]
}

/// The barycentric weights of the point at scaled distances `d` (`scaled`) of triangle `t`: each
/// distance over its corner's own.
pub(super) fn weights(t: [Point; 3], d: [f64; 3]) -> [f64; 3] {
    [
        d[0] / line(t[1], t[2], t[0]),
        d[1] / line(t[2], t[0], t[1]),
        d[2] / line(t[0], t[1], t[2]),
    ]
}

/// The point of the segment from `a` to `b` nearest `p`, and its squared distance, taken over
/// `nearest` when strictly nearer: either end, or the foot of the perpendicular when it falls
/// strictly inside the segment.
fn segment(a: Point, b: Point, p: Point, nearest: &mut (Point, f64)) {
    for end in [a, b] {
        let to = sub(p, end);
        let squared = dot(to, to);
        if squared < nearest.1 {
            *nearest = (end, squared);
        }
    }
    let edge = sub(b, a);
    let length = dot(edge, edge).sqrt();
    let edge = [edge[0] / length, edge[1] / length];
    let ray = sub(p, a);
    let along = dot(ray, edge);
    if along > 0.0 && along < length {
        let foot = scale(edge, along);
        let normal = sub(ray, foot);
        let squared = dot(normal, normal);
        if squared < nearest.1 {
            *nearest = (add(foot, a), squared);
        }
    }
}

/// The point of triangle `t`'s edges nearest `p`, edge after edge from the first corner, and its
/// squared distance.
pub(super) fn nearest(t: [Point; 3], p: Point) -> (Point, f64) {
    let mut nearest = ([0.0; 2], f64::MAX);
    for k in 0..3 {
        segment(t[k], t[(k + 1) % 3], p, &mut nearest);
    }
    nearest
}
