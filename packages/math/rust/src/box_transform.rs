//! `boxTransform` of `packages/math/src/geometry/box.ts` (which calls `boxCornersInto`, `boxEmpty`
//! and `boxExpandByPoint`) in f64, term by term and parentheses included: the same bits as
//! JavaScript (why: `packages/page-codec-wasm/src/math.rs`), with its `Math.min` and `Math.max`
//! (`js`).

use crate::js::{js_max, js_min};

/// Floats of a box laid out flat, like `BOX_VALUES` in `packages/math/src/geometry/box.ts`.
pub const BOX_VALUES: usize = 6;
/// Floats of a box's eight transformed corners.
const CORNER_VALUES: usize = 24;

/// `boxTransform` of one box: `out` and `boxes` hold six floats, `m` sixteen. An empty box —
/// an upper bound below its lower bound — is copied as-is, bounds included.
#[inline]
pub fn box_transform(out: &mut [f64], boxes: &[f64], m: &[f64]) {
    let (lo, hi) = (
        [boxes[0], boxes[1], boxes[2]],
        [boxes[3], boxes[4], boxes[5]],
    );
    if hi[0] < lo[0] || hi[1] < lo[1] || hi[2] < lo[2] {
        out[..BOX_VALUES].copy_from_slice(&boxes[..BOX_VALUES]);
        return;
    }
    if !affine_box(out, lo, hi, m) {
        corner_walk(out, lo, hi, m);
    }
}

/// The eight corners `((m₀·x + m₄·y) + m₈·z) + m₁₂` (and the other rows), each divided by its `w`
/// through `· (1 / w)`, then their smallest and largest coordinates in `Math.min` and `Math.max`.
fn corner_walk(out: &mut [f64], lo: [f64; 3], hi: [f64; 3], m: &[f64]) {
    let mut corners = [0f64; CORNER_VALUES];
    for i in 0..8usize {
        let lx = if i & 1 != 0 { hi[0] } else { lo[0] };
        let ly = if i & 2 != 0 { hi[1] } else { lo[1] };
        let lz = if i & 4 != 0 { hi[2] } else { lo[2] };
        let mw = 1.0 / (m[3] * lx + m[7] * ly + m[11] * lz + m[15]);
        let at = i * 3;
        corners[at] = (m[0] * lx + m[4] * ly + m[8] * lz + m[12]) * mw;
        corners[at + 1] = (m[1] * lx + m[5] * ly + m[9] * lz + m[13]) * mw;
        corners[at + 2] = (m[2] * lx + m[6] * ly + m[10] * lz + m[14]) * mw;
    }
    out[..3].fill(f64::INFINITY);
    out[3..BOX_VALUES].fill(f64::NEG_INFINITY);
    for at in (0..CORNER_VALUES).step_by(3) {
        for axis in 0..3 {
            out[axis] = js_min(out[axis], corners[at + axis]);
            out[3 + axis] = js_max(out[3 + axis], corners[at + axis]);
        }
    }
}

/// `corner_walk`'s result without its eight corners, when `m` is affine — last row `±0, ±0, ±0,
/// 1` — and the nine products of its linear part by the box's bounds are finite (here
/// exact, not a bound). Then `w = ((±0 + ±0) + ±0) + 1 = 1` and `x · (1 / 1) = x`; and a corner is
/// `((a + b) + c) + d`, `a` one of the two products on x, `b` on y, `c` on z. A rounded sum is
/// non-decreasing in each operand, so the corner of the smallest terms is the smallest corner and
/// that of the largest the largest: the same floats, computed by the same operations. Signed
/// zeros: a rounded sum is `-0` exactly when every operand is, so `Math.min` of the terms gives
/// `-0` exactly when a corner is `-0`, and `Math.max` `+0` exactly when a corner is `+0`. Finite
/// products also mean finite bounds — `0 · ∞` is NaN — and no `∞ − ∞`: no corner is NaN. `false`
/// leaves `out` to the corner walk.
fn affine_box(out: &mut [f64], lo: [f64; 3], hi: [f64; 3], m: &[f64]) -> bool {
    if m[3] != 0.0 || m[7] != 0.0 || m[11] != 0.0 || m[15] != 1.0 {
        return false;
    }
    // `terms[axis][row]`: the products of the box's bounds on `axis` by column `axis` of `m`.
    let terms =
        [0, 1, 2].map(|axis| [0, 1, 2].map(|row| [lo, hi].map(|b| m[axis * 4 + row] * b[axis])));
    if !terms.iter().flatten().flatten().all(|t| t.is_finite())
        || !m[12..15].iter().all(|t| t.is_finite())
    {
        return false;
    }
    for row in 0..3 {
        let [a, b, c] = [0, 1, 2].map(|axis| terms[axis][row]);
        let d = m[12 + row];
        out[row] = ((js_min(a[0], a[1]) + js_min(b[0], b[1])) + js_min(c[0], c[1])) + d;
        out[3 + row] = ((js_max(a[0], a[1]) + js_max(b[0], b[1])) + js_max(c[0], c[1])) + d;
    }
    true
}

#[cfg(test)]
#[path = "box_transform_tests.rs"]
mod tests;
