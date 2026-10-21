//! The adaptive in-circle test, in double precision: with each of `a`, `b`, `c` taken relative to
//! `d`, the determinant `|a|²(b × c) + |b|²(c × a) + |c|²(a × b)`.
//!
//! 1. Rounded once: returned when its magnitude exceeds the first bound times its permanent (the
//!    same sum with every cross product's two terms and the result taken by magnitude).
//! 2. Each cross product formed exactly, scaled twice by each coordinate of the third point and
//!    the three sums added exactly, the expansion summed into one float: returned when it reaches
//!    the second bound.
//! 3. Returned as it is when no relative coordinate lost anything to rounding (the expansion was
//!    then the exact determinant).
//! 4. Corrected by the first-order terms of the coordinates' rounding errors: returned when it
//!    reaches the third bound, which adds the error of that correction.
//! 5. Otherwise every term carrying a rounding error is added exactly to the expansion (`tails`),
//!    and the largest component of the exact sum is returned.
mod tails;

use super::expansion::{approximate, product_difference, scaled, sub_error, sum_expansions};
use super::precision::{Precision, DOUBLE_ROUNDOFF};

/// The first bound, on the once-rounded determinant, relative to its permanent.
const FILTER_BOUND: f64 = (10.0 + 96.0 * DOUBLE_ROUNDOFF) * DOUBLE_ROUNDOFF;
/// The second bound, on the determinant of the rounded coordinates summed exactly then rounded.
const ESTIMATE_BOUND: f64 = (4.0 + 48.0 * DOUBLE_ROUNDOFF) * DOUBLE_ROUNDOFF;
/// The third bound, on the estimate corrected by the coordinates' first-order rounding errors.
const TAIL_BOUND: f64 = (44.0 + 576.0 * DOUBLE_ROUNDOFF) * DOUBLE_ROUNDOFF * DOUBLE_ROUNDOFF;
/// The most components the exact determinant can take.
const MOST_COMPONENTS: usize = 1152;

/// Where `d` lies against the circle through `a`, `b`, `c`, its sign exact (module doc).
pub(super) fn in_circle_adaptive(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> f64 {
    let ax = a[0] - d[0];
    let bx = b[0] - d[0];
    let cx = c[0] - d[0];
    let ay = a[1] - d[1];
    let by = b[1] - d[1];
    let cy = c[1] - d[1];
    let bx_cy = bx * cy;
    let cx_by = cx * by;
    let a_norm = ax * ax + ay * ay;
    let cx_ay = cx * ay;
    let ax_cy = ax * cy;
    let b_norm = bx * bx + by * by;
    let ax_by = ax * by;
    let bx_ay = bx * ay;
    let c_norm = cx * cx + cy * cy;
    let rounded = a_norm * (bx_cy - cx_by) + b_norm * (cx_ay - ax_cy) + c_norm * (ax_by - bx_ay);
    let magnitudes = (bx_cy.magnitude() + cx_by.magnitude()) * a_norm
        + (cx_ay.magnitude() + ax_cy.magnitude()) * b_norm
        + (ax_by.magnitude() + bx_ay.magnitude()) * c_norm;
    let bound = FILTER_BOUND * magnitudes;
    if rounded > bound || -rounded > bound {
        return rounded;
    }
    refined([a, b, c], d, magnitudes)
}

/// A corner of the test relative to `d`: its rounded coordinates and the floats each lost.
struct Corner {
    x: f64,
    y: f64,
    x_lost: f64,
    y_lost: f64,
}

/// The exact determinant built so far, and a second buffer each addition writes into before the
/// two swap.
struct Running {
    now: Vec<f64>,
    spare: Vec<f64>,
    len: usize,
}

impl Running {
    /// `e` added exactly to the determinant.
    fn add(&mut self, e: &[f64]) {
        self.len = sum_expansions(&self.now[..self.len], e, &mut self.spare);
        std::mem::swap(&mut self.now, &mut self.spare);
    }
}

/// `cross` (four components) times `x²` plus `cross` times `y²`, exactly, with its length.
fn lifted(cross: &[f64; 4], x: f64, y: f64) -> ([f64; 32], usize) {
    let mut by_x = [0.0; 8];
    let by_x_len = scaled(cross, x, &mut by_x);
    let mut by_xx = [0.0; 16];
    let by_xx_len = scaled(&by_x[..by_x_len], x, &mut by_xx);
    let mut by_y = [0.0; 8];
    let by_y_len = scaled(cross, y, &mut by_y);
    let mut by_yy = [0.0; 16];
    let by_yy_len = scaled(&by_y[..by_y_len], y, &mut by_yy);
    let mut sum = [0.0; 32];
    let sum_len = sum_expansions(&by_xx[..by_xx_len], &by_yy[..by_yy_len], &mut sum);
    (sum, sum_len)
}

/// Stages 2 to 5 of the module doc for `corners` (`a`, `b`, `c`) against `d`.
fn refined(corners: [[f64; 2]; 3], d: [f64; 2], magnitudes: f64) -> f64 {
    let [a, b, c] = corners;
    let ax = a[0] - d[0];
    let bx = b[0] - d[0];
    let cx = c[0] - d[0];
    let ay = a[1] - d[1];
    let by = b[1] - d[1];
    let cy = c[1] - d[1];
    // The cross product of the two corners after each one, in corner order.
    let crosses = [
        product_difference(bx, cy, cx, by),
        product_difference(cx, ay, ax, cy),
        product_difference(ax, by, bx, ay),
    ];
    let (a_part, a_len) = lifted(&crosses[0], ax, ay);
    let (b_part, b_len) = lifted(&crosses[1], bx, by);
    let (c_part, c_len) = lifted(&crosses[2], cx, cy);
    let mut ab = [0.0; 64];
    let ab_len = sum_expansions(&a_part[..a_len], &b_part[..b_len], &mut ab);
    let mut running = Running {
        now: vec![0.0; MOST_COMPONENTS],
        spare: vec![0.0; MOST_COMPONENTS],
        len: 0,
    };
    running.len = sum_expansions(&ab[..ab_len], &c_part[..c_len], &mut running.now);
    let mut value = approximate(&running.now[..running.len]);
    let bound = ESTIMATE_BOUND * magnitudes;
    if value >= bound || -value >= bound {
        return value;
    }
    let ax_lost = sub_error(a[0], d[0], ax);
    let ay_lost = sub_error(a[1], d[1], ay);
    let bx_lost = sub_error(b[0], d[0], bx);
    let by_lost = sub_error(b[1], d[1], by);
    let cx_lost = sub_error(c[0], d[0], cx);
    let cy_lost = sub_error(c[1], d[1], cy);
    if [ax_lost, bx_lost, cx_lost, ay_lost, by_lost, cy_lost]
        .iter()
        .all(|&lost| lost == 0.0)
    {
        return value;
    }
    let bound = TAIL_BOUND * magnitudes + <f64 as Precision>::RESULT_BOUND * value.magnitude();
    value += ((ax * ax + ay * ay)
        * ((bx * cy_lost + cy * bx_lost) - (by * cx_lost + cx * by_lost))
        + 2.0 * (ax * ax_lost + ay * ay_lost) * (bx * cy - by * cx))
        + ((bx * bx + by * by) * ((cx * ay_lost + ay * cx_lost) - (cy * ax_lost + ax * cy_lost))
            + 2.0 * (bx * bx_lost + by * by_lost) * (cx * ay - cy * ax))
        + ((cx * cx + cy * cy) * ((ax * by_lost + by * ax_lost) - (ay * bx_lost + bx * ay_lost))
            + 2.0 * (cx * cx_lost + cy * cy_lost) * (ax * by - ay * bx));
    if value >= bound || -value >= bound {
        return value;
    }
    let corner = |x, y, x_lost, y_lost| Corner {
        x,
        y,
        x_lost,
        y_lost,
    };
    let corners = [
        corner(ax, ay, ax_lost, ay_lost),
        corner(bx, by, bx_lost, by_lost),
        corner(cx, cy, cx_lost, cy_lost),
    ];
    tails::add_tails(&corners, &crosses, &mut running);
    running.now[running.len - 1]
}
