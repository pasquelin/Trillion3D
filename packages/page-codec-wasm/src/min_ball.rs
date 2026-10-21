//! The smallest ball enclosing a set of points, by randomised incremental construction in its
//! iterative form: one nested scan per support point, over a deterministic shuffle of the points
//! (expected linear time, the same result on every host); it is the one smallest-ball solver of
//! points. The balls a DAG group and a culling node enclose their children's with are the
//! reference's ball of balls (`balls.rs`), never the smallest.
use circumscribed::{circumscribed, diameter};
use trillion3d_math::geometry::sphere::farthest;
use trillion3d_math::sequence::random::xorshift64;
use trillion3d_math::vector::vec3::point;
use trillion3d_math::vector::vecn::{dot, sub};

mod circumscribed;

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

/// Reorders `items` by a Fisher–Yates shuffle driven by a xorshift seeded with their count:
/// the order the expected linear time needs, and the same order on every run.
fn shuffle<T>(items: &mut [T]) {
    let mut state = 0x2545_f491_4f6c_dd1du64 ^ items.len() as u64;
    for i in (1..items.len()).rev() {
        items.swap(i, (xorshift64(&mut state) % (i as u64 + 1)) as usize);
    }
}

/// The smallest ball enclosing `points`, which it reorders, up to the rounding of its support
/// points' circumscribed ball; `None` when there is none. Coincident points are taken once: a
/// repeated point in a support makes its circumscribed balls degenerate, and the construction
/// then loses points it had enclosed.
pub fn min_ball(points: &mut [[f64; 3]]) -> Option<Ball> {
    points.sort_unstable_by_key(|p| p.map(f64::to_bits));
    let mut kept = 0;
    for at in 0..points.len() {
        if kept == 0 || points[at] != points[kept - 1] {
            points[kept] = points[at];
            kept += 1;
        }
    }
    let p = &mut points[..kept];
    shuffle(p);
    let p = &*p;
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
    // `min_ball` takes each point once and reorders them; the radius re-measured below depends on
    // neither.
    let mut points: Vec<[f64; 3]> = indices.iter().map(|&v| point(positions, v)).collect();
    let Some((c, _)) = min_ball(&mut points) else {
        return [0.0; 4];
    };
    let radius = farthest(c, points.iter().map(|&p| (p, 0.0)));
    if c.iter().all(|v| v.is_finite()) && radius.is_finite() {
        [c[0], c[1], c[2], radius]
    } else {
        [0.0; 4]
    }
}

#[cfg(test)]
mod tests;
