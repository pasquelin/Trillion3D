//! Batch calculation kernels of the math foundation, in f64, to the bits of the JavaScript version.
//!
//! Each function reproduces term by term, parentheses included, the floating-point operation order
//! of its counterpart in `packages/sdk-core/`: `mathMatrix4.ts::multiplyMatrix4` and
//! `mathBox.ts::boxTransform` (which calls `boxCornersInto`, `boxEmpty` and `boxExpandByPoint`).
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
//! Rust does not promise to. Both are rewritten here.

/// Floats of a box laid out flat, like `BOX_VALUES` in `mathBox.ts`.
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
fn js_min(a: f64, b: f64) -> f64 {
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
fn js_max(a: f64, b: f64) -> f64 {
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

/// `boxTransform` of one box: `out` and `boxes` hold six floats, `m` sixteen. An empty box —
/// an upper bound below its lower bound — is copied as-is, bounds included.
fn box_transform_one(out: &mut [f64], boxes: &[f64], m: &[f64]) {
    let (min_x, min_y, min_z) = (boxes[0], boxes[1], boxes[2]);
    let (max_x, max_y, max_z) = (boxes[3], boxes[4], boxes[5]);
    if max_x < min_x || max_y < min_y || max_z < min_z {
        out[0] = min_x;
        out[1] = min_y;
        out[2] = min_z;
        out[3] = max_x;
        out[4] = max_y;
        out[5] = max_z;
        return;
    }
    let mut corners = [0f64; CORNER_VALUES];
    for i in 0..8usize {
        let lx = if i & 1 != 0 { max_x } else { min_x };
        let ly = if i & 2 != 0 { max_y } else { min_y };
        let lz = if i & 4 != 0 { max_z } else { min_z };
        let mw = 1.0 / (m[3] * lx + m[7] * ly + m[11] * lz + m[15]);
        let at = i * 3;
        corners[at] = (m[0] * lx + m[4] * ly + m[8] * lz + m[12]) * mw;
        corners[at + 1] = (m[1] * lx + m[5] * ly + m[9] * lz + m[13]) * mw;
        corners[at + 2] = (m[2] * lx + m[6] * ly + m[10] * lz + m[14]) * mw;
    }
    out[0] = f64::INFINITY;
    out[1] = f64::INFINITY;
    out[2] = f64::INFINITY;
    out[3] = f64::NEG_INFINITY;
    out[4] = f64::NEG_INFINITY;
    out[5] = f64::NEG_INFINITY;
    for at in (0..CORNER_VALUES).step_by(3) {
        out[0] = js_min(out[0], corners[at]);
        out[1] = js_min(out[1], corners[at + 1]);
        out[2] = js_min(out[2], corners[at + 2]);
        out[3] = js_max(out[3], corners[at]);
        out[4] = js_max(out[4], corners[at + 1]);
        out[5] = js_max(out[5], corners[at + 2]);
    }
}

/// `multiplyMatrix4` of a pair: the thirty-two inputs are read before the first write, and each
/// term is the sum of four products with no initial zero — a sum started at `0` would change the
/// sign of a negative zero.
pub(crate) fn multiply_matrix4_one(out: &mut [f64], a: &[f64], b: &[f64]) {
    let (a11, a12, a13, a14) = (a[0], a[4], a[8], a[12]);
    let (a21, a22, a23, a24) = (a[1], a[5], a[9], a[13]);
    let (a31, a32, a33, a34) = (a[2], a[6], a[10], a[14]);
    let (a41, a42, a43, a44) = (a[3], a[7], a[11], a[15]);
    let (b11, b12, b13, b14) = (b[0], b[4], b[8], b[12]);
    let (b21, b22, b23, b24) = (b[1], b[5], b[9], b[13]);
    let (b31, b32, b33, b34) = (b[2], b[6], b[10], b[14]);
    let (b41, b42, b43, b44) = (b[3], b[7], b[11], b[15]);
    out[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    out[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    out[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    out[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    out[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    out[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    out[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    out[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    out[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    out[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    out[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    out[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    out[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    out[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    out[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    out[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
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

/// `n` products `out[i] = a[i] · b[i]`, the three buffers laid out flat and disjoint.
pub fn multiply_matrix4_batch(out: &mut [f64], a: &[f64], b: &[f64], n: usize) {
    for i in 0..n {
        let at = i * MATRIX_VALUES;
        let (left, right) = (&a[at..at + MATRIX_VALUES], &b[at..at + MATRIX_VALUES]);
        multiply_matrix4_one(&mut out[at..at + MATRIX_VALUES], left, right);
    }
}
