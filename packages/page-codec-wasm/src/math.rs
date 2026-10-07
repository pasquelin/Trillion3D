//! Batch calculation kernels of the math foundation, in f64, to the bits of the JavaScript version.
//!
//! Each function reproduces term by term, parentheses included, the floating-point operation order
//! of its counterpart in `packages/math/`: `packages/math/src/matrix/matrix4.ts::multiplyMatrix4` (`math_matrix.rs`) and
//! `packages/math/src/geometry/box.ts::boxTransform` (which calls `boxCornersInto`, `boxEmpty` and `boxExpandByPoint`).
//!
//! Equality is structural, not hoped for. WebAssembly has no fused multiply-add instruction:
//! neither the base set nor `simd128` carries one, and `relaxed-simd`, the only extension that
//! has one, is refused then verified by `scripts/build-wasm.ts`. Its f64 arithmetic is IEEE-754,
//! correctly rounded, exactly that of JavaScript numbers. And rustc never enables floating-point
//! reassociation: it has no equivalent of `-ffast-math`, so `lto`, `opt-level` and automatic
//! vectorisation can only reorder independent lanes, never reassociate a sum.
//!
//! JavaScript's `Math.min` and `Math.max` are not Rust's `f64::min` and `f64::max`: the former
//! propagate NaN where the latter discard it, and JavaScript distinguishes `-0` from `+0` where
//! Rust does not promise to. Both are rewritten here, with `Math.hypot`, for every kernel of the
//! crate that must give JavaScript's bits.

/// Floats of a box laid out flat, like `BOX_VALUES` in `packages/math/src/geometry/box.ts`.
pub const BOX_VALUES: usize = 6;
/// Floats of a column-major 4×4 matrix.
pub const MATRIX_VALUES: usize = 16;
/// Floats of a box's eight transformed corners.
const CORNER_VALUES: usize = 24;

/// `Math.min`: NaN contaminates, and `-0` wins over `+0`. That is IEEE-754-2019 `minimum`, which
/// Rust's `f64::min` is NOT — that one is `minNum`, which discards a NaN instead of propagating it —
/// and which `f64::minimum` will be once it leaves nightly. Meanwhile, the comparison first: on
/// ordinary coordinates, one of the first two tests answers, and the rest costs nothing.
#[inline]
pub(crate) fn js_min(a: f64, b: f64) -> f64 {
    if a < b {
        a
    } else if b < a {
        b
    } else if a == b {
        // Equal: only `-0` versus `+0` remains to be distinguished, and JavaScript returns `-0`.
        if a.is_sign_negative() {
            a
        } else {
            b
        }
    } else {
        // No comparison is true: one of the two is NaN, and `Math.min` propagates it.
        f64::NAN
    }
}

/// `Math.max`: NaN contaminates, and `+0` wins over `-0`. IEEE-754-2019 `maximum`.
#[inline]
pub(crate) fn js_max(a: f64, b: f64) -> f64 {
    if a > b {
        a
    } else if b > a {
        b
    } else if a == b {
        if a.is_sign_positive() {
            a
        } else {
            b
        }
    } else {
        f64::NAN
    }
}

/// The squares of `values` summed in order with Kahan compensation: each step takes back from the
/// next square what the rounding of the running sum lost.
#[inline]
pub(crate) fn compensated_squares<const N: usize>(values: [f64; N]) -> f64 {
    let (mut sum, mut compensation) = (0.0f64, 0.0f64);
    for value in values {
        let summand = value * value - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum
}

/// `Math.hypot` of `values` to the bit (`hypot2`, `hypot3`, `hypot4` of
/// `packages/math/src/float/hypot.ts`): every magnitude divided by the largest, the
/// squares summed with compensation, the root scaled back; an infinity before a NaN. The
/// specification leaves `Math.hypot` approximated; this is the rounding Chrome and Node return,
/// where a plain `sqrt` of the squares differs in the last bit on a large share of inputs. The
/// compensation's first step is exact, so two values are the plain sum of their two squares.
pub(crate) fn hypot<const N: usize>(values: [f64; N]) -> f64 {
    let magnitudes = values.map(f64::abs);
    // `f64::max` passes over a NaN, as `Math.hypot` takes the largest of the others.
    let max = magnitudes.into_iter().fold(0.0, f64::max);
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if magnitudes.iter().any(|v| v.is_nan()) {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    compensated_squares(magnitudes.map(|v| v / max)).sqrt() * max
}

/// `boxTransform` of one box: `out` and `boxes` hold six floats, `m` sixteen. An empty box —
/// an upper bound below its lower bound — is copied as-is, bounds included.
fn box_transform_one(out: &mut [f64], boxes: &[f64], m: &[f64]) {
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

/// `n` boxes transformed by `n` matrices, the three buffers laid out flat and disjoint.
pub fn box_transform_batch(out: &mut [f64], boxes: &[f64], mats: &[f64], n: usize) {
    for i in 0..n {
        let o = i * BOX_VALUES;
        let m = i * MATRIX_VALUES;
        box_transform_one(
            &mut out[o..o + BOX_VALUES],
            &boxes[o..o + BOX_VALUES],
            &mats[m..m + MATRIX_VALUES],
        );
    }
}

#[cfg(test)]
#[path = "math_tests.rs"]
mod tests;
