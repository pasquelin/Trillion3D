//! The point of a triangle, or of a polygon, closest to a point, in double precision.
//!
//! The triangle's is ported from its documentation, OpenVDB shipping it only as a binary: the
//! Voronoi regions of Ericson's Real-Time Collision Detection (pp. 136–142), tested in his order
//! — the region of corner `a`, of corner `b`, of edge `ab`, of corner `c`, of edge `ac`, of edge
//! `bc`, then the face —, each point as he writes it. Before them, as OpenVDB documents, the
//! degenerate triangles: three coincident corners give `a`; `a` on `b` gives the closest point of
//! segment `bc`; `a` or `b` on `c` that of segment `ab`. Two corners coincide when each axis is
//! within `10⁻⁷` of the other, absolutely or relative to the larger. The barycentric weights the
//! documented function also returns are left out: no caller reads them, and the point does not
//! depend on them.
use super::Polygons;
use trillion3d_math::scalar::not_above;
use trillion3d_math::vector::vecn::{add, dot, scale, squared_length, sub};

type V3 = [f64; 3];

/// The absolute and the relative tolerance under which two corners' axes coincide.
const COINCIDENT: f64 = 1e-7;

/// The point of the triangle `a, b, c` closest to `p`.
pub(super) fn on_triangle(a: V3, b: V3, c: V3, p: V3) -> V3 {
    if coincide(a, b) && coincide(a, c) {
        return a;
    }
    if coincide(a, b) {
        return on_segment(b, c, p);
    }
    if coincide(a, c) || coincide(b, c) {
        return on_segment(a, b, p);
    }
    let (ab, ac, ap) = (sub(b, a), sub(c, a), sub(p, a));
    let (d1, d2) = (dot(ab, ap), dot(ac, ap));
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = sub(p, b);
    let (d3, d4) = (dot(ab, bp), dot(ac, bp));
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return add(a, scale(ab, d1 / (d1 - d3)));
    }
    let cp = sub(p, c);
    let (d5, d6) = (dot(ab, cp), dot(ac, cp));
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return add(a, scale(ac, d2 / (d2 - d6)));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return add(b, scale(sub(c, b), w));
    }
    let denom = 1.0 / (va + vb + vc);
    let (v, w) = (vb * denom, vc * denom);
    add(add(a, scale(ab, v)), scale(ac, w))
}

/// The point of the segment `a, b` closest to `p`: `a` where `p` projects before it, `b` where
/// it projects past it, else `a` plus the projection's fraction of `ab`.
fn on_segment(a: V3, b: V3, p: V3) -> V3 {
    let ab = sub(b, a);
    let t = dot(sub(p, a), ab);
    if t <= 0.0 {
        return a;
    }
    let denom = dot(ab, ab);
    if t >= denom {
        return b;
    }
    add(a, scale(ab, t / denom))
}

/// Whether `p` and `q` coincide: every axis `coincident`.
fn coincide(p: V3, q: V3) -> bool {
    (0..3).all(|k| coincident(p[k], q[k]))
}

/// Whether `x` and `y` are within `COINCIDENT` of each other, absolutely (NaN included), or
/// relative to the larger in magnitude (`x` when both are as large).
fn coincident(x: f64, y: f64) -> bool {
    if not_above((x - y).abs(), COINCIDENT) {
        return true;
    }
    let relative = if y.abs() > x.abs() {
        ((x - y) / y).abs()
    } else {
        ((x - y) / x).abs()
    };
    relative <= COINCIDENT
}

/// The point of polygon `polygon` closest to `p`: that of its triangle `(a, c, b)`, or, for a
/// quad, that of its triangle `(a, d, c)` where strictly nearer.
pub(super) fn on_polygon(polygons: &impl Polygons, polygon: usize, p: V3) -> V3 {
    let corner = |k| polygons.point(polygon, k);
    let (a, b, c) = (corner(0), corner(1), corner(2));
    let first = on_triangle(a, c, b, p);
    if polygons.corners(polygon) != 4 {
        return first;
    }
    let second = on_triangle(a, corner(3), c, p);
    if squared_length(sub(p, second)) < squared_length(sub(p, first)) {
        second
    } else {
        first
    }
}
