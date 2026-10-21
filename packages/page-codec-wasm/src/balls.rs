//! THE BALLS an error is projected through, in single precision, one home for every builder that
//! bounds a cluster, a group or a node of the culling hierarchy: the DAG's (`asset-compiler-rust`'s
//! `dag/bounds.rs`, `dag/reduce.rs`), the page assignment's walk (`compiler/pages/bundles`) and the
//! hierarchy's nodes (`culling.rs`).
//!
//! **A ball of points** (Ritter 1990, `points_ball`). The extreme points along each axis, the first
//! of equals kept; the pair of one axis farthest apart, the first axis of equals, is the first
//! diameter. Then every point in order whose squared distance from the centre exceeds the first
//! radius squared — that first square, never the grown one's — pulls the centre towards it to the
//! point a half plus half the radius over its distance of the way from it, and the radius to the
//! mean of the radius and its distance.
//!
//! **A ball of balls** (`balls_ball`). The balls reaching furthest down and up along each axis, the
//! first of equals kept; the pair of one axis whose centres' distance plus both radii is the
//! largest, the first axis of equals, is joined first (`join`); then every ball in order is joined
//! to the result.
use crate::encode::vertices::first_use;
use trillion3d_math::vector::vec3::point_f32;
use trillion3d_math::vector::vecn::{add, distance2, length, scale, squared_length, sub};

/// The slack of the nested test, in square metres, and the least distance between centres that
/// moves one, in metres: the reference's tolerances, measured in centimetres (1e-4 cm² and
/// 1e-8 cm), brought to the metres the DAG is built in.
const NESTED_SLACK: f32 = 1e-8;
const SAME_CENTRE: f32 = 1e-10;

/// A ball in single precision: its centre and radius.
#[derive(Clone, Copy)]
struct Ball {
    centre: [f32; 3],
    radius: f32,
}
impl Ball {
    fn of(sphere: [f64; 4]) -> Self {
        Self {
            centre: [sphere[0], sphere[1], sphere[2]].map(|x| x as f32),
            radius: sphere[3] as f32,
        }
    }
    fn sphere(self) -> [f64; 4] {
        let [x, y, z] = self.centre.map(f64::from);
        [x, y, z, f64::from(self.radius)]
    }
    /// This ball grown to hold `other`: `other` when this one has no radius; the larger of the
    /// two when one holds the other — the squared difference of the radii, plus `NESTED_SLACK`,
    /// at least the squared distance of the centres —; else the ball whose diameter runs from this
    /// one's far side to the other's, its centre moved from this one's only when the centres lie
    /// more than `SAME_CENTRE` apart.
    fn join(self, other: Ball) -> Ball {
        if self.radius == 0.0 {
            return other;
        }
        let to_other = sub(other.centre, self.centre);
        let apart2 = squared_length(to_other);
        let gap = self.radius - other.radius;
        if gap * gap + NESTED_SLACK >= apart2 {
            return if self.radius < other.radius {
                other
            } else {
                self
            };
        }
        let distance = apart2.sqrt();
        let radius = (distance + other.radius + self.radius) * 0.5;
        let mut centre = self.centre;
        if distance > SAME_CENTRE {
            centre = add(centre, scale(to_other, (radius - self.radius) / distance));
        }
        Ball { centre, radius }
    }
}

/// The ball of the vertices of a cluster's triangles `indices` over `positions`, in their order of
/// first use (the module's rule for points). Empty, the zero ball.
pub fn points_ball(positions: &[f32], indices: &[u32]) -> [f64; 4] {
    let (vertices, _) = first_use(indices.iter().copied());
    let points: Vec<[f32; 3]> = (vertices.iter())
        .map(|&v| point_f32(positions, v as usize))
        .collect();
    if points.is_empty() {
        return [0.0; 4];
    }
    let (mut low, mut high) = ([0usize; 3], [0usize; 3]);
    for (i, p) in points.iter().enumerate() {
        for k in 0..3 {
            if p[k] < points[low[k]][k] {
                low[k] = i;
            }
            if p[k] > points[high[k]][k] {
                high[k] = i;
            }
        }
    }
    let (mut widest, mut axis) = (0.0_f32, 0);
    for k in 0..3 {
        let span2 = distance2(points[high[k]], points[low[k]]);
        if span2 > widest {
            (widest, axis) = (span2, k);
        }
    }
    let mut centre = scale(add(points[low[axis]], points[high[axis]]), 0.5);
    let mut radius = 0.5 * widest.sqrt();
    let first2 = radius * radius;
    for &p in &points {
        let reach2 = distance2(p, centre);
        if reach2 > first2 {
            let distance = reach2.sqrt();
            let t = 0.5 + 0.5 * (radius / distance);
            centre = add(scale(p, 1.0 - t), scale(centre, t));
            radius = 0.5 * (radius + distance);
        }
    }
    Ball { centre, radius }.sphere()
}

/// The ball of `spheres` (the module's rule for balls). Empty, the zero ball.
pub fn balls_ball(spheres: &[[f64; 4]]) -> [f64; 4] {
    let balls: Vec<Ball> = spheres.iter().map(|&s| Ball::of(s)).collect();
    if balls.is_empty() {
        return [0.0; 4];
    }
    let (mut low, mut high) = ([0usize; 3], [0usize; 3]);
    for (i, b) in balls.iter().enumerate() {
        for k in 0..3 {
            let (down, up) = (b.centre[k] - b.radius, b.centre[k] + b.radius);
            if down < balls[low[k]].centre[k] - balls[low[k]].radius {
                low[k] = i;
            }
            if up > balls[high[k]].centre[k] + balls[high[k]].radius {
                high[k] = i;
            }
        }
    }
    let (mut widest, mut axis) = (0.0_f32, 0);
    for k in 0..3 {
        let (a, b) = (balls[low[k]], balls[high[k]]);
        let span = length(sub(b.centre, a.centre)) + a.radius + b.radius;
        if span > widest {
            (widest, axis) = (span, k);
        }
    }
    let first = balls[low[axis]].join(balls[high[axis]]);
    (balls.iter())
        .fold(first, |ball, &other| ball.join(other))
        .sphere()
}
