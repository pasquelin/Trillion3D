//! The smallest ball enclosing a set of points, by randomised incremental construction in its
//! iterative form: one nested scan per support point, over a deterministic shuffle of the points
//! (expected linear time, the same result on every host). The normal cone (`normal_cone.rs`)
//! takes the ball of the unit face normals; it is the one smallest-ball solver, for points and for
//! the ball of balls a DAG group and a culling node (`culling.rs`) enclose their children's with
//! (`ball_of_balls`), exact by pivoting on its support (`through::basis`).
use through::{basis, radius_for};
use trillion3d_math::random::xorshift64;
use trillion3d_math::vec3::{cross, point};
use trillion3d_math::vecn::{add, dot, length, scale, sub};

mod through;

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

/// Reorders `items` by a Fisher–Yates shuffle driven by a xorshift seeded with their count:
/// the order the expected linear time needs, and the same order on every run.
fn shuffle<T>(items: &mut [T]) {
    let mut state = 0x2545_f491_4f6c_dd1du64 ^ items.len() as u64;
    for i in (1..items.len()).rev() {
        items.swap(i, (xorshift64(&mut state) % (i as u64 + 1)) as usize);
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

/// The smallest sphere of `indices`' vertices (`min_ball`), the one sphere a level-0 cluster is
/// projected with: its radius re-measured in float64 from the final centre, so every vertex is
/// inside by construction, not by the solver. No vertex, or one that is not a number, gives the
/// zero sphere.
pub fn point_sphere(positions: &[f32], indices: &[u32]) -> [f64; 4] {
    let mut ids = indices.to_vec();
    ids.sort_unstable();
    ids.dedup();
    // `min_ball` reorders the points; the radius re-measured below does not depend on their order.
    let mut points: Vec<[f64; 3]> = ids.iter().map(|&v| point(positions, v)).collect();
    let Some((c, _)) = min_ball(&mut points) else {
        return [0.0; 4];
    };
    let radius = points
        .iter()
        .map(|&p| length(sub(p, c)))
        .fold(0.0, f64::max);
    if c.iter().all(|v| v.is_finite()) && radius.is_finite() {
        [c[0], c[1], c[2], radius]
    } else {
        [0.0; 4]
    }
}

/// Relative margin the ball of balls is inflated by, of its coordinates' magnitude: containment
/// then survives the float64 rounding of any re-check (8.5e-14 m outside without it at 1 km).
const CONTAINMENT_MARGIN: f64 = 1e-12;

/// The smallest sphere enclosing `spheres` (those of negative radius are absent), exactly, by
/// pivoting: the support of the current ball (at most four spheres) takes in the first sphere it
/// does not hold, and `basis` gives the smallest ball of that support and the newcomer. Each pivot
/// grows the ball, so it stops, at a ball the smallest of its support that holds every sphere:
/// the smallest ball of all. Never larger than any other enclosing sphere. Its radius is then
/// re-measured from the final centre — the rule the runtime's containment proof reads —, so every
/// sphere is inside by construction, and raised by `CONTAINMENT_MARGIN`. No sphere gives the zero
/// sphere; one, itself.
pub fn ball_of_balls(spheres: &[[f64; 4]]) -> [f64; 4] {
    let mut live: Vec<[f64; 4]> = spheres.iter().copied().filter(|s| s[3] >= 0.0).collect();
    match live.len() {
        0 => return [0.0; 4],
        1 => return live[0],
        _ => {}
    }
    shuffle(&mut live);
    let holds = |ball: &[f64; 4], b: &[f64; 4]| {
        let d = sub([b[0], b[1], b[2]], [ball[0], ball[1], ball[2]]);
        length(d) + b[3] <= ball[3] * (1.0 + SLACK) + 1e-300
    };
    let (mut support, mut ball) = (vec![live[0]], live[0]);
    // In exact arithmetic every pivot grows the ball; the bound only guards against rounding
    // cycling between equal balls, whose re-measured radius below holds every sphere anyway.
    for _ in 0..4 * live.len() + 64 {
        let Some(outside) = live.iter().find(|b| !holds(&ball, b)) else {
            break;
        };
        support.push(*outside);
        (support, ball) = basis(&support);
    }
    let c = [ball[0], ball[1], ball[2]];
    let r = radius_for(c, &live);
    let magnitude = c[0].abs().max(c[1].abs()).max(c[2].abs()).max(r);
    [c[0], c[1], c[2], r + magnitude * CONTAINMENT_MARGIN]
}

#[cfg(test)]
#[path = "min_ball_tests.rs"]
mod tests;
