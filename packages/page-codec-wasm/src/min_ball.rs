//! The smallest ball enclosing a set of points, by randomised incremental construction in its
//! iterative form: one nested scan per support point, over a deterministic shuffle of the points
//! (expected linear time, the same result on every host). The normal cone (`normal_cone.rs`)
//! takes the ball of the unit face normals; it is the one smallest-ball solver, beside the
//! box-centred sphere of `asset-compiler-rust/src/dag/bounds.rs`.
use crate::vec3::{add, cross, dot, length, scale, sub};

/// A ball as its centre and radius.
pub type Ball = ([f64; 3], f64);

/// Relative slack of the containment test: a point on the boundary of a circumscribed ball is
/// inside despite the rounding of the circumcentre.
const SLACK: f64 = 1e-12;

/// A ball and the squared radius its containment test compares with, slack included: computed
/// once per ball rather than once per test, the same operations on the same radius.
struct Held(Ball, f64);

impl Held {
    fn new(ball: Ball) -> Self {
        let r = ball.1 * (1.0 + SLACK);
        Self(ball, r * r + 1e-300)
    }

    /// Squared distances: no square root in the solver's innermost test.
    fn contains(&self, p: [f64; 3]) -> bool {
        let d = sub(p, self.0 .0);
        dot(d, d) <= self.1
    }
}

/// The ball of which `a` and `b` are a diameter.
fn diameter(a: [f64; 3], b: [f64; 3]) -> Ball {
    let centre = scale(add(a, b), 0.5);
    (centre, length(sub(a, centre)))
}

fn widest(balls: &[Ball]) -> Ball {
    *balls
        .iter()
        .max_by(|x, y| x.1.total_cmp(&y.1))
        .expect("candidates")
}

/// The smallest ball through the 3 or 4 points `p` (circumscribed), or, when they are
/// degenerate (coincident, colinear or coplanar), the widest ball of a subset.
fn circumscribed(p: &[[f64; 3]]) -> Ball {
    match p.len() {
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
            (add(p[0], k), length(k))
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
            (add(p[0], k), length(k))
        }
    }
}

/// Reorders `points` by a Fisher–Yates shuffle driven by a xorshift seeded with their count:
/// the order the expected linear time needs, and the same order on every run.
fn shuffle(points: &mut [[f64; 3]]) {
    let mut state = 0x2545_f491_4f6c_dd1du64 ^ points.len() as u64;
    for i in (1..points.len()).rev() {
        points.swap(i, (xorshift(&mut state) % (i as u64 + 1)) as usize);
    }
}

/// One step of a xorshift (13, 7, 17): the shuffle's draws, and the crate's tests'.
pub(crate) fn xorshift(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

/// The smallest ball enclosing `points`, which it shuffles, up to the rounding of its support
/// points' circumscribed ball; `None` when there is none.
pub fn min_ball(points: &mut [[f64; 3]]) -> Option<Ball> {
    shuffle(points);
    let p = &*points;
    let mut ball = Held::new((*p.first()?, 0.0));
    for i in 1..p.len() {
        if ball.contains(p[i]) {
            continue;
        }
        ball = Held::new((p[i], 0.0));
        for j in 0..i {
            if ball.contains(p[j]) {
                continue;
            }
            ball = Held::new(diameter(p[i], p[j]));
            for k in 0..j {
                if ball.contains(p[k]) {
                    continue;
                }
                ball = Held::new(circumscribed(&[p[i], p[j], p[k]]));
                for l in 0..k {
                    if !ball.contains(p[l]) {
                        ball = Held::new(circumscribed(&[p[i], p[j], p[k], p[l]]));
                    }
                }
            }
        }
    }
    Some(ball.0)
}

#[cfg(test)]
#[path = "min_ball_tests.rs"]
mod tests;
