//! The smallest ball enclosing a set of points, by randomised incremental construction in its
//! iterative form: one nested scan per support point, over a deterministic shuffle of the points
//! (expected linear time, the same result on every host). The normal cone (`normal_cone.rs`)
//! takes the ball of the unit face normals; it is the one smallest-ball solver, beside the
//! box-centred sphere of `asset-compiler-rust/src/dag/bounds.rs`; with it, the ball of balls a DAG
//! group and a culling node (`culling.rs`) enclose their children's with (`ball_of_balls`).
use trillion3d_math::aabb::{aabb_of_boxes, centre};
use trillion3d_math::random::xorshift64;
use trillion3d_math::sphere::enclosing_sphere;
use trillion3d_math::vec3::{add, cross, dot, length, scale, sub};
use trillion3d_math::vecn::lerp;

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
        points.swap(i, (xorshift64(&mut state) % (i as u64 + 1)) as usize);
    }
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

/// Iterations of the centre pull toward the farthest ball, with a shrinking step.
const WALK_STEPS: usize = 64;
/// Relative margin a tightened sphere is inflated by, of its coordinates' magnitude: containment
/// then survives the float64 rounding of any re-check (8.5e-14 m outside without it at 1 km).
const CONTAINMENT_MARGIN: f64 = 1e-12;

/// The radius a sphere centred on `c` needs to enclose every live sphere of `spheres`.
fn radius_for(c: [f64; 3], spheres: &[[f64; 4]]) -> f64 {
    spheres
        .iter()
        .map(|s| length(sub([s[0], s[1], s[2]], c)) + s[3])
        .fold(0.0, f64::max)
}

/// A sphere enclosing `spheres` (those of negative radius are absent), never larger than
/// [`enclosing_sphere`]'s: the smallest of that merge's centre, the centre of the spheres' box
/// and the steps of a centre pull toward the far point of the farthest ball. Each radius is
/// recomputed as `max |c_i - C| + r_i`, the rule the runtime's containment proof reads.
pub fn ball_of_balls(spheres: &[[f64; 4]]) -> [f64; 4] {
    let merged = enclosing_sphere(spheres);
    let live: Vec<[f64; 4]> = spheres.iter().copied().filter(|s| s[3] >= 0.0).collect();
    if live.len() < 2 {
        return merged;
    }
    let mut best = merged;
    let consider = |c: [f64; 3], best: &mut [f64; 4]| {
        let r = radius_for(c, &live);
        if r < best[3] {
            *best = [c[0], c[1], c[2], r];
        }
    };
    consider([merged[0], merged[1], merged[2]], &mut best);
    let (lo, hi) = aabb_of_boxes(live.iter().map(|s| {
        (
            [0, 1, 2].map(|a| s[a] - s[3]),
            [0, 1, 2].map(|a| s[a] + s[3]),
        )
    }));
    consider(centre(lo, hi), &mut best);
    // Pull the centre toward the far point of the farthest ball, by 1/(k + 1) of the way at step k.
    let mut c = [best[0], best[1], best[2]];
    for k in 1..=WALK_STEPS {
        let far = live
            .iter()
            .map(|s| (length(sub([s[0], s[1], s[2]], c)) + s[3], s))
            .max_by(|a, b| a.0.total_cmp(&b.0))
            .map(|(_, s)| *s)
            .expect("two live spheres");
        let dir = sub([far[0], far[1], far[2]], c);
        let l = length(dir);
        let reach = if l > 0.0 { far[3] / l } else { 0.0 };
        let target = [0, 1, 2].map(|a| far[a] + dir[a] * reach);
        let t = 1.0 / (k as f64 + 1.0);
        c = lerp(c, target, t);
        consider(c, &mut best);
    }
    let magnitude = best[0]
        .abs()
        .max(best[1].abs())
        .max(best[2].abs())
        .max(best[3]);
    best[3] += magnitude * CONTAINMENT_MARGIN;
    if best[3] < merged[3] {
        best
    } else {
        merged
    }
}

#[cfg(test)]
#[path = "min_ball_tests.rs"]
mod tests;
