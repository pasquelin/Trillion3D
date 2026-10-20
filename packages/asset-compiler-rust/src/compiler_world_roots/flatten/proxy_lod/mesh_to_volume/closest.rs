//! The closest point of a triangle.
use trillion3d_math::vecn::{dot, sub};

/// Whether `a` and `b` agree within `tol`, absolute or relative to the larger.
fn rel_or_approx_equal(a: f64, b: f64, tol: f64) -> bool {
    if !((a - b).abs() > tol) {
        return true;
    }
    let rel = if b.abs() > a.abs() {
        ((a - b) / b).abs()
    } else {
        ((a - b) / a).abs()
    };
    rel <= tol
}

/// Whether `a` and `b` agree axis by axis within the default relative or absolute 1e-7.
fn approx_equal(a: [f64; 3], b: [f64; 3]) -> bool {
    (0..3).all(|k| rel_or_approx_equal(a[k], b[k], 1.0e-7))
}

/// The point of segment `a`–`b` nearest `p`.
fn closest_point_on_segment(a: [f64; 3], b: [f64; 3], p: [f64; 3]) -> [f64; 3] {
    let ab = sub(b, a);
    let t = dot(sub(p, a), ab);
    if t <= 0.0 {
        return a;
    }
    let denom = dot(ab, ab);
    if t >= denom {
        return b;
    }
    let t = t / denom;
    [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
}

/// The point of triangle `a`, `b`, `c` nearest `p` (Ericson's Voronoi region walk),
/// with its degenerate triangle and edge cases.
pub(super) fn closest_point_on_triangle(
    a: [f64; 3],
    b: [f64; 3],
    c: [f64; 3],
    p: [f64; 3],
) -> [f64; 3] {
    if approx_equal(a, b) && approx_equal(a, c) {
        return a;
    }
    let ab = sub(b, a);
    let ac = sub(c, a);
    let ap = sub(p, a);
    let d1 = dot(ab, ap);
    let d2 = dot(ac, ap);
    if approx_equal(a, b) {
        return closest_point_on_segment(a, c, p);
    } else if approx_equal(a, c) || approx_equal(b, c) {
        return closest_point_on_segment(a, b, p);
    }
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = sub(p, b);
    let d3 = dot(ab, bp);
    let d4 = dot(ac, bp);
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        let v = d1 / (d1 - d3);
        return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
    }
    let cp = sub(p, c);
    let d5 = dot(ab, cp);
    let d6 = dot(ac, cp);
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        let w = d2 / (d2 - d6);
        return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        let bc = sub(c, b);
        return [b[0] + bc[0] * w, b[1] + bc[1] * w, b[2] + bc[2] * w];
    }
    let denom = 1.0 / (va + vb + vc);
    let w = vc * denom;
    let v = vb * denom;
    [
        a[0] + ab[0] * v + ac[0] * w,
        a[1] + ab[1] * v + ac[1] * w,
        a[2] + ab[2] * v + ac[2] * w,
    ]
}
