//! The smallest ball enclosing a set of points, by Welzl's algorithm in its iterative form: one
//! nested scan per support point, over a deterministic shuffle of the points (expected linear
//! time, the same result on every host). The normal cone (`normal_cone.rs`) takes the ball of the
//! unit face normals; any other smallest ball reuses this one.
//!
//! The solver's radius is only as exact as its circumscribed balls: a caller that needs every
//! point inside re-measures the radius from the returned centre.
use crate::vec3::{cross, dot, length, sub};

/// A ball as its centre and radius.
pub type Ball = ([f64; 3], f64);

/// Relative slack of the containment test: a point on the boundary of a circumscribed ball is
/// inside despite the rounding of the circumcentre.
const SLACK: f64 = 1e-12;

fn contains(ball: &Ball, p: [f64; 3]) -> bool {
    length(sub(p, ball.0)) <= ball.1 * (1.0 + SLACK) + 1e-300
}

/// The ball of which `a` and `b` are a diameter.
fn diameter(a: [f64; 3], b: [f64; 3]) -> Ball {
    let centre = [
        (a[0] + b[0]) * 0.5,
        (a[1] + b[1]) * 0.5,
        (a[2] + b[2]) * 0.5,
    ];
    (centre, length(sub(a, centre)))
}

fn widest(balls: &[Ball]) -> Ball {
    *balls
        .iter()
        .max_by(|x, y| x.1.total_cmp(&y.1))
        .expect("candidates")
}

/// The smallest ball through the 2, 3 or 4 points `p` (circumscribed), or, when they are
/// degenerate (coincident, colinear or coplanar), the widest ball of a subset.
fn circumscribed(p: &[[f64; 3]]) -> Ball {
    match p.len() {
        2 => diameter(p[0], p[1]),
        3 => {
            let (ab, ac) = (sub(p[1], p[0]), sub(p[2], p[0]));
            let n = cross(ab, ac);
            let d = 2.0 * dot(n, n);
            if d.abs() < 1e-300 {
                return widest(&[
                    diameter(p[0], p[1]),
                    diameter(p[0], p[2]),
                    diameter(p[1], p[2]),
                ]);
            }
            let (t, u) = (cross(n, ab), cross(ac, n));
            let k = [0, 1, 2].map(|i| (dot(ac, ac) * t[i] + dot(ab, ab) * u[i]) / d);
            ([p[0][0] + k[0], p[0][1] + k[1], p[0][2] + k[2]], length(k))
        }
        _ => {
            let (u, v, w) = (sub(p[1], p[0]), sub(p[2], p[0]), sub(p[3], p[0]));
            let det = 2.0 * dot(u, cross(v, w));
            if det.abs() < 1e-300 {
                return widest(&[
                    circumscribed(&p[..3]),
                    circumscribed(&[p[0], p[1], p[3]]),
                    circumscribed(&[p[0], p[2], p[3]]),
                    circumscribed(&p[1..]),
                ]);
            }
            let (vw, wu, uv) = (cross(v, w), cross(w, u), cross(u, v));
            let (uu, vv, ww) = (dot(u, u), dot(v, v), dot(w, w));
            let k = [0, 1, 2].map(|i| (uu * vw[i] + vv * wu[i] + ww * uv[i]) / det);
            ([p[0][0] + k[0], p[0][1] + k[1], p[0][2] + k[2]], length(k))
        }
    }
}

/// Reorders `points` by a Fisher–Yates shuffle driven by a xorshift seeded with their count:
/// the order Welzl's expected time needs, and the same order on every run.
fn shuffle(points: &mut [[f64; 3]]) {
    let mut state = 0x2545_f491_4f6c_dd1du64 ^ points.len() as u64;
    for i in (1..points.len()).rev() {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        points.swap(i, (state % (i as u64 + 1)) as usize);
    }
}

/// The smallest ball enclosing `points`, which it shuffles; `None` when there is none.
pub fn min_ball(points: &mut [[f64; 3]]) -> Option<Ball> {
    shuffle(points);
    let p = &*points;
    let mut ball = (*p.first()?, 0.0);
    for i in 1..p.len() {
        if contains(&ball, p[i]) {
            continue;
        }
        ball = (p[i], 0.0);
        for j in 0..i {
            if contains(&ball, p[j]) {
                continue;
            }
            ball = circumscribed(&[p[i], p[j]]);
            for k in 0..j {
                if contains(&ball, p[k]) {
                    continue;
                }
                ball = circumscribed(&[p[i], p[j], p[k]]);
                for l in 0..k {
                    if !contains(&ball, p[l]) {
                        ball = circumscribed(&[p[i], p[j], p[k], p[l]]);
                    }
                }
            }
        }
    }
    Some(ball)
}

#[cfg(test)]
#[path = "min_ball_tests.rs"]
mod tests;
