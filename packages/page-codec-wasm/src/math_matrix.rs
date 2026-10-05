//! `multiplyMatrix4` in f64, to the bits of `packages/sdk-core/src/math/matrix/matrix4.ts`: the
//! rules of `math.rs` hold here. Column `j` of the product is `((A₀·b₀ + A₁·b₁) + A₂·b₂) + A₃·b₃`,
//! `Aₖ` the k-th column of `a` and `bₖ` the k-th float of column `j` of `b`.

use crate::math::MATRIX_VALUES;

/// `multiplyMatrix4` of a pair: the thirty-two inputs are read before the first write, and each
/// term is the sum of four products with no initial zero — a sum started at `0` would change the
/// sign of a negative zero. With `simd128`, two rows per `f64x2`: each lane runs the scalar
/// operations in the scalar order, correctly rounded lane by lane, so the same bits.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
pub(crate) fn multiply_matrix4_one(out: &mut [f64], a: &[f64], b: &[f64]) {
    use core::arch::wasm32::{f64x2, f64x2_add, f64x2_extract_lane, f64x2_mul, f64x2_splat};
    // `columns[k][half]`: rows `2·half` and `2·half + 1` of column `k` of `a`.
    let columns = [0, 1, 2, 3].map(|k| [0, 2].map(|row| f64x2(a[4 * k + row], a[4 * k + row + 1])));
    let mut product = [0f64; MATRIX_VALUES];
    for j in 0..4 {
        let terms = [0, 1, 2, 3].map(|k| f64x2_splat(b[4 * j + k]));
        for half in 0..2 {
            let term = |k: usize| f64x2_mul(columns[k][half], terms[k]);
            let sum = f64x2_add(f64x2_add(f64x2_add(term(0), term(1)), term(2)), term(3));
            product[4 * j + 2 * half] = f64x2_extract_lane::<0>(sum);
            product[4 * j + 2 * half + 1] = f64x2_extract_lane::<1>(sum);
        }
    }
    out[..MATRIX_VALUES].copy_from_slice(&product);
}

/// `multiplyMatrix4` of a pair: the thirty-two inputs are read before the first write, and each
/// term is the sum of four products with no initial zero — a sum started at `0` would change the
/// sign of a negative zero.
#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
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

/// `n` products `out[i] = a[i] · b[i]`, the three buffers laid out flat and disjoint.
pub fn multiply_matrix4_batch(out: &mut [f64], a: &[f64], b: &[f64], n: usize) {
    for i in 0..n {
        let at = i * MATRIX_VALUES;
        let (left, right) = (&a[at..at + MATRIX_VALUES], &b[at..at + MATRIX_VALUES]);
        multiply_matrix4_one(&mut out[at..at + MATRIX_VALUES], left, right);
    }
}
