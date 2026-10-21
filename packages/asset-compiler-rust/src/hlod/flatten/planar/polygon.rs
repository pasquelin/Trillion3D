//! The triangulation of a simple polygon by its ears, in double precision:
//!
//! 1. the polygon's winding read from twice its signed area, the sum of `cross(pᵢ, pᵢ₊₁)` in corner
//!    order: clockwise when the sum is negative, counterclockwise otherwise;
//! 2. a polygon of fewer than three corners has no triangle; a triangle is itself;
//! 3. otherwise its corners are linked in a ring, and an ear is sought from corner 0: corner `e`,
//!    between `p = prev(e)` and `n = next(e)`, is an ear when the triangle `p, e, n` turns the
//!    polygon's way — half the sum `cross(p, e) + cross(e, n) + cross(n, p)`, times the winding's
//!    sign, not negative — and no other corner of the ring lies strictly inside it (its three
//!    inexact turns `double_area` all of one sign, the products of each two positive);
//! 4. an ear is cut: `p, e, n` written out, `e` unlinked, the search going on from `p`; a corner
//!    that is no ear passes the search on to `n`. Once every corner left was tried in a row
//!    without an ear — collinear or otherwise degenerate corners —, the corner reached is cut as
//!    if it were one; the last three corners are always cut.
//!
//! A polygon of `n ≥ 3` corners gives `n − 2` triangles, each winding as the polygon does, a ring
//! of corners every cut keeps: the triangles form one disk across their shared sides.
use trillion3d_math::vector::vec2::{cross, double_area};

/// Whether the triangle `a, b, c` turns against the polygon whose winding's sign is `sign`: half
/// the sum `(cross(a, b) + cross(b, c)) + cross(c, a)`, times the sign, below zero.
fn turns_against(sign: f64, a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> bool {
    let area = 0.5 * ((cross(a, b) + cross(b, c)) + cross(c, a));
    area * sign < 0.0
}

/// Whether `p` lies strictly inside the triangle `a, b, c`: its inexact turns against the three
/// sides (`double_area`) pairwise of one sign, none zero.
fn strictly_inside(a: [f64; 2], b: [f64; 2], c: [f64; 2], p: [f64; 2]) -> bool {
    let (s1, s2, s3) = (
        double_area(a, b, p),
        double_area(b, c, p),
        double_area(c, a, p),
    );
    s1 * s2 > 0.0 && s2 * s3 > 0.0 && s3 * s1 > 0.0
}

/// The triangles of the simple polygon `polygon` by its ears (module doc), each three corner
/// ranks `[prev, ear, next]` in the order the ears were cut; none for fewer than three corners.
pub(crate) fn triangulate_simple(polygon: &[[f64; 2]]) -> Vec<[usize; 3]> {
    let count = polygon.len();
    if count < 3 {
        return Vec::new();
    }
    let mut twice_area = 0.0f64;
    for (i, &corner) in polygon.iter().enumerate() {
        twice_area += cross(corner, polygon[(i + 1) % count]);
    }
    let sign = if twice_area < 0.0 { -1.0 } else { 1.0 };
    if count == 3 {
        return vec![[0, 1, 2]];
    }
    let mut prev: Vec<usize> = (0..count).map(|v| (v + count - 1) % count).collect();
    let mut next: Vec<usize> = (0..count).map(|v| (v + 1) % count).collect();
    let mut triangles = Vec::with_capacity(count - 2);
    let (mut ear, mut tried, mut left) = (0, 0, count);
    while left >= 3 {
        let mut is_ear = true;
        if left > 3 && tried < left {
            let (a, b, c) = (polygon[prev[ear]], polygon[ear], polygon[next[ear]]);
            if turns_against(sign, a, b, c) {
                is_ear = false;
            } else {
                let mut test = next[next[ear]];
                loop {
                    if strictly_inside(a, b, c, polygon[test]) {
                        is_ear = false;
                        break;
                    }
                    test = next[test];
                    if test == prev[ear] {
                        break;
                    }
                }
            }
        }
        if is_ear {
            triangles.push([prev[ear], ear, next[ear]]);
            next[prev[ear]] = next[ear];
            prev[next[ear]] = prev[ear];
            left -= 1;
            ear = prev[ear];
            tried = 0;
        } else {
            ear = next[ear];
            tried += 1;
        }
    }
    triangles
}
