//! The order the packer sorts by, and a chart's least-area box.
//!
//! `sorted_ranks` is a stable ascending order of floats: under 32 values an insertion sort by `<`,
//! from 32 on `total_cmp`'s order (negative values below the positive ones, `−0` before `+0`), as
//! a byte-wise radix sort of their bits flipped leaves them.
//!
//! `least_box` takes the convex hull of a chart's boundary vertices (Andrew's monotone chain on
//! the points sorted by `x`, a turn kept only when it is clockwise by more than `10⁻⁵`), and for
//! each hull edge (from the previous hull point, skipping points `near` the previous) boxes all the
//! chart's vertices along it; the box of least area wins, the first on a tie.
use super::vector::{bounds2, least, most, near2, signed_half_area, unit, Vec2, EPSILON};
use trillion3d_math::vector::vecn::{dot, sub};

/// The hull's tolerance on the turn of three points.
const HULL_EPSILON: f32 = 0.00001;

pub(super) fn sorted_ranks(values: &[f32]) -> Vec<usize> {
    let mut ranks: Vec<usize> = (0..values.len()).collect();
    if values.len() < 32 {
        for i in 1..values.len() {
            let rank = ranks[i];
            let mut j = i;
            while j != 0 && values[rank] < values[ranks[j - 1]] {
                ranks[j] = ranks[j - 1];
                j -= 1;
            }
            ranks[j] = rank;
        }
    } else {
        ranks.sort_by(|&a, &b| values[a].total_cmp(&values[b]));
    }
    ranks
}

/// A chart's box: its major axis, and its least corner along it and its minor axis (the major
/// turned a quarter counter-clockwise); all zero when no hull edge boxes the vertices.
#[derive(Clone, Copy)]
pub(super) struct AxisBox {
    pub(super) major: Vec2,
    pub(super) min: Vec2,
}

impl AxisBox {
    /// The major axis turned a quarter counter-clockwise.
    pub(super) fn minor(&self) -> Vec2 {
        [-self.major[1], self.major[0]]
    }
}

/// The least-area box of `vertices` along the edges of the hull of `boundary`.
pub(super) fn least_box(boundary: &[Vec2], vertices: &[Vec2]) -> AxisBox {
    let hull = hull_of(boundary);
    let mut best_area = f32::MAX;
    let mut best = AxisBox {
        major: [0.0; 2],
        min: [0.0; 2],
    };
    for (i, &point) in hull.iter().enumerate() {
        let previous = hull[if i == 0 { hull.len() - 1 } else { i - 1 }];
        if near2(point, previous, EPSILON) {
            continue;
        }
        let mut axes = AxisBox {
            major: unit(sub(point, previous)),
            min: [0.0; 2],
        };
        let minor = axes.minor();
        let (low, high) = bounds2(
            vertices
                .iter()
                .map(|&p| [dot(axes.major, p), dot(minor, p)]),
        );
        let area = (high[0] - low[0]) * (high[1] - low[1]);
        if area < best_area {
            best_area = area;
            axes.min = low;
            best = axes;
        }
    }
    best
}

/// The convex hull of `points`, clockwise from the least `x`. Fewer than two points, or points of
/// no finite order, are returned as they are.
fn hull_of(points: &[Vec2]) -> Vec<Vec2> {
    let n = points.len();
    if n < 2 {
        return points.to_vec();
    }
    let xs: Vec<f32> = points.iter().map(|p| p[0]).collect();
    let ranks = sorted_ranks(&xs);
    let (p, q) = (points[ranks[0]], points[ranks[n - 1]]);
    let (top_y, bottom_y) = (most(p[1], q[1]), least(p[1], q[1]));
    let top: Vec<Vec2> = (ranks.iter())
        .map(|&rank| points[rank])
        .filter(|point| point[1] >= bottom_y)
        .collect();
    let bottom: Vec<Vec2> = (ranks.iter().rev())
        .map(|&rank| points[rank])
        .filter(|point| point[1] <= top_y)
        .collect();
    if top.len() < 2 || bottom.len() < 2 {
        return points.to_vec();
    }
    let mut hull = vec![top[0], top[1]];
    chain(&mut hull, &top, 1);
    let top_count = hull.len();
    hull.push(bottom[1]);
    chain(&mut hull, &bottom, top_count);
    hull.pop();
    hull
}

/// The points `side[2..]` added to `hull`, each popping the hull's last point while the turn to
/// it is not clockwise by more than `HULL_EPSILON`, never below `floor` points. A turn of no
/// finite value keeps the point (where an unbounded loop would otherwise never move on).
fn chain(hull: &mut Vec<Vec2>, side: &[Vec2], floor: usize) {
    let mut i = 2;
    while i < side.len() {
        let (a, b, c) = (hull[hull.len() - 2], hull[hull.len() - 1], side[i]);
        let area = signed_half_area(a, b, c);
        if area >= -HULL_EPSILON {
            hull.pop();
        }
        if area < -HULL_EPSILON || area.is_nan() || hull.len() == floor {
            hull.push(c);
            i += 1;
        }
    }
}
