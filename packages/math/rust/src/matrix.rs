//! `multiplyMatrix4` in f64, to the bits of `packages/math/src/matrix/matrix4.ts` (why
//! the bits are JavaScript's: `packages/page-codec-wasm/src/math.rs`). Column `j` of the product is
//! `((A₀·b₀ + A₁·b₁) + A₂·b₂) + A₃·b₃`, `Aₖ` the k-th column of `a` and `bₖ` the k-th float of
//! column `j` of `b`. The same product in `f32` or `f64` (`multiply_matrix4`) is the compiler's,
//! with the translation, scaling and glTF node composition its scene drivers build matrices from.

use crate::real::Real;

/// Floats of a column-major 4×4 matrix.
pub const MATRIX_VALUES: usize = 16;

/// The identity in `f64`; `rotation::identity` gives it in either precision.
pub const IDENTITY: [f64; MATRIX_VALUES] = [
    1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
];

/// `multiplyMatrix4` of a pair: the thirty-two inputs are read before the first write, and each
/// term is the sum of four products with no initial zero — a sum started at `0` would change the
/// sign of a negative zero. With `simd128`, two rows per `f64x2`: each lane runs the scalar
/// operations in the scalar order, correctly rounded lane by lane, so the same bits.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline]
pub fn multiply_matrix4_one(out: &mut [f64], a: &[f64], b: &[f64]) {
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

/// `multiplyMatrix4` of a pair: `multiply_matrix4`, its thirty-two inputs read before the first
/// write.
#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
#[inline]
pub fn multiply_matrix4_one(out: &mut [f64], a: &[f64], b: &[f64]) {
    let matrix = |m| <&[f64; MATRIX_VALUES]>::try_from(m).expect("sixteen floats");
    let product = multiply_matrix4(matrix(&a[..MATRIX_VALUES]), matrix(&b[..MATRIX_VALUES]));
    out[..MATRIX_VALUES].copy_from_slice(&product);
}

/// `a · b`, each entry the sum of its four products in step order with no initial zero: summed
/// from `-0.0`, which `-0.0 + x` returns bit for bit — a sum started at `0` would change the sign
/// of a negative zero.
#[inline]
pub fn multiply_matrix4<T: Real>(
    a: &[T; MATRIX_VALUES],
    b: &[T; MATRIX_VALUES],
) -> [T; MATRIX_VALUES] {
    summed(a, b, T::NEG_ZERO)
}

/// `a · b`, each entry summed from `+0.0` in step order: four negative-zero products give `+0.0`
/// where `multiply_matrix4` keeps `-0.0`: the glTF, Maya, USD and physics compositions' rounding.
#[inline]
pub fn multiply_matrix4_from_zero<T: Real>(
    a: &[T; MATRIX_VALUES],
    b: &[T; MATRIX_VALUES],
) -> [T; MATRIX_VALUES] {
    summed(a, b, T::ZERO)
}

#[inline(always)]
fn summed<T: Real>(a: &[T; MATRIX_VALUES], b: &[T; MATRIX_VALUES], start: T) -> [T; MATRIX_VALUES] {
    core::array::from_fn(|at| {
        let (column, row) = (at / 4, at % 4);
        (0..4)
            .map(|step| a[step * 4 + row] * b[column * 4 + step])
            .fold(start, |sum, term| sum + term)
    })
}

/// `n` products `out[i] = a[i] · b[i]`, the three buffers laid out flat and disjoint.
pub fn multiply_matrix4_batch(out: &mut [f64], a: &[f64], b: &[f64], n: usize) {
    for i in 0..n {
        let at = i * MATRIX_VALUES;
        let (left, right) = (&a[at..at + MATRIX_VALUES], &b[at..at + MATRIX_VALUES]);
        multiply_matrix4_one(&mut out[at..at + MATRIX_VALUES], left, right);
    }
}

/// `point` under the affine part of the column-major `matrix`, row by row
/// `((m₀·x + m₄·y) + m₈·z) + m₁₂`: no division by `w`.
#[inline]
pub fn transform_point(matrix: &[f64; MATRIX_VALUES], point: [f64; 3]) -> [f64; 3] {
    let mut out = [0.0f64; 3];
    for row in 0..3 {
        out[row] = matrix[row] * point[0]
            + matrix[4 + row] * point[1]
            + matrix[8 + row] * point[2]
            + matrix[12 + row];
    }
    out
}

/// `direction` under the linear part of the column-major `matrix`, row by row
/// `(m₀·x + m₄·y) + m₈·z`: no translation.
#[inline]
pub fn transform_direction(matrix: &[f64; MATRIX_VALUES], direction: [f64; 3]) -> [f64; 3] {
    core::array::from_fn(|row| {
        matrix[row] * direction[0] + matrix[4 + row] * direction[1] + matrix[8 + row] * direction[2]
    })
}

/// Floats of an affine map laid out as three rows of four, row-major: `[m₀₀, m₀₁, m₀₂, t₀, …]`.
pub const AFFINE_3X4_VALUES: usize = 12;

/// `point` under the row-major 3×4 affine map `m`, in `f64` and rounded once to `f32`: row by row
/// `((m₀·x + m₁·y) + m₂·z) + m₃`, every float widened first.
#[inline]
pub fn transform_point_3x4_f32(m: &[f32; AFFINE_3X4_VALUES], point: [f32; 3]) -> [f32; 3] {
    core::array::from_fn(|r| {
        (m[r * 4] as f64 * point[0] as f64
            + m[r * 4 + 1] as f64 * point[1] as f64
            + m[r * 4 + 2] as f64 * point[2] as f64
            + m[r * 4 + 3] as f64) as f32
    })
}

/// Translation by `by`.
pub fn translation(by: [f64; 3]) -> [f64; MATRIX_VALUES] {
    let mut out = IDENTITY;
    out[12..15].copy_from_slice(&by);
    out
}

/// Scaling by `by`, axis by axis.
pub fn scaling(by: [f64; 3]) -> [f64; MATRIX_VALUES] {
    let mut out = IDENTITY;
    for axis in 0..3 {
        out[axis * 4 + axis] = by[axis];
    }
    out
}

/// Translation · rotation · scale, as glTF composes a node: the rotation of the unit quaternion
/// `r` (`rotation::rotation_matrix`), each of its columns times its scale, then `t` written in.
pub fn compose_trs(t: [f64; 3], r: [f64; 4], s: [f64; 3]) -> [f64; MATRIX_VALUES] {
    let mut matrix = crate::rotation::rotation_matrix(r);
    for column in 0..3 {
        for row in 0..3 {
            matrix[column * 4 + row] *= s[column];
        }
    }
    matrix[12..15].copy_from_slice(&t);
    matrix
}

#[cfg(test)]
#[path = "matrix_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "matrix_apply_tests.rs"]
mod apply_tests;
