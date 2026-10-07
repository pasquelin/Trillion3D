//! Batch calculation kernels of the math foundation, in f64, to the bits of the JavaScript version.
//!
//! Each function reproduces term by term, parentheses included, the floating-point operation order
//! of its counterpart in `packages/math/`: `packages/math/src/matrix/matrix4.ts::multiplyMatrix4` (`trillion3d_math::matrix`) and
//! `packages/math/src/geometry/box.ts::boxTransform` (`trillion3d_math::box_transform`).
//!
//! Equality is structural, not hoped for. WebAssembly has no fused multiply-add instruction:
//! neither the base set nor `simd128` carries one, and `relaxed-simd`, the only extension that
//! has one, is refused then verified by `scripts/build-wasm.ts`. Its f64 arithmetic is IEEE-754,
//! correctly rounded, exactly that of JavaScript numbers. And rustc never enables floating-point
//! reassociation: it has no equivalent of `-ffast-math`, so `lto`, `opt-level` and automatic
//! vectorisation can only reorder independent lanes, never reassociate a sum.
//!
//! JavaScript's `Math.min`, `Math.max` and `Math.hypot` are those of `trillion3d_math::js`.

use trillion3d_math::box_transform::box_transform;
pub use trillion3d_math::box_transform::BOX_VALUES;
use trillion3d_math::matrix::MATRIX_VALUES;

/// `n` boxes transformed by `n` matrices, the three buffers laid out flat and disjoint.
pub fn box_transform_batch(out: &mut [f64], boxes: &[f64], mats: &[f64], n: usize) {
    for i in 0..n {
        let o = i * BOX_VALUES;
        let m = i * MATRIX_VALUES;
        box_transform(
            &mut out[o..o + BOX_VALUES],
            &boxes[o..o + BOX_VALUES],
            &mats[m..m + MATRIX_VALUES],
        );
    }
}
