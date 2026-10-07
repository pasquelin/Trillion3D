//! The rotations scene drivers compose their matrices with, each written once, generic over the
//! driver's precision (`Real`): Blender turns in `f32`, the others in `f64`. A driver whose
//! rounding differs keeps its own function here, under its own name: a turn by sine and cosine
//! (`turn`) and the same turn by its quaternion (`axis_rotation`) round apart.

use crate::matrix::{IDENTITY, MATRIX_VALUES};
use crate::real::Real;

/// The identity matrix, in the caller's precision.
#[inline]
pub fn identity<T: Real>() -> [T; MATRIX_VALUES] {
    let mut out = [T::ZERO; MATRIX_VALUES];
    for diagonal in 0..4 {
        out[diagonal * 5] = T::ONE;
    }
    out
}

/// Rotation of `radians` around axis `axis` (0 = X, 1 = Y, 2 = Z), from its sine and cosine, as
/// the Blender and USD drivers turn.
pub fn turn<T: Real>(axis: usize, radians: T) -> [T; MATRIX_VALUES] {
    let (sin, cos) = radians.sin_cos();
    let (first, second) = ((axis + 1) % 3, (axis + 2) % 3);
    let mut out = identity();
    out[first * 4 + first] = cos;
    out[second * 4 + second] = cos;
    out[first * 4 + second] = sin;
    out[second * 4 + first] = -sin;
    out
}

/// The rotation of a unit quaternion `(x, y, z, w)`, column by column, as glTF writes it.
#[rustfmt::skip]
pub fn rotation_matrix<T: Real>([x, y, z, w]: [T; 4]) -> [T; MATRIX_VALUES] {
    let (one, two, zero) = (T::ONE, T::TWO, T::ZERO);
    [
        one - two * (y * y + z * z), two * (x * y + z * w), two * (x * z - y * w), zero,
        two * (x * y - z * w), one - two * (x * x + z * z), two * (y * z + x * w), zero,
        two * (x * z + y * w), two * (y * z - x * w), one - two * (x * x + y * y), zero,
        zero, zero, zero, one,
    ]
}

/// Rotation of a quaternion written `(w, x, y, z)`, divided by its length first
/// (`quaternion::length`, `quaternion::divide`). A length `usable` refuses rotates nothing: the
/// guard is each driver's own.
pub fn quaternion_wxyz<T: Real>(q: [T; 4], usable: impl Fn(T) -> bool) -> [T; MATRIX_VALUES] {
    let length = crate::quaternion::length(q);
    if !usable(length) {
        return identity();
    }
    let [w, x, y, z] = crate::quaternion::divide(q, length);
    rotation_matrix([x, y, z, w])
}

/// The quaternion `(w, x, y, z)` of `angle` around the unit `axis`, by its half angle: the half
/// angle's cosine, then each axis times its sine. Blender's axis-angle.
pub fn half_angle_wxyz<T: Real>([x, y, z]: [T; 3], angle: T) -> [T; 4] {
    let half = angle / T::TWO;
    let sin = half.sin();
    [half.cos(), x * sin, y * sin, z * sin]
}

/// Rotation of `radians` around axis `axis` (0 = X, 1 = Y, 2 = Z), by its quaternion, as the
/// Maya driver turns.
pub fn axis_rotation(axis: usize, radians: f64) -> [f64; MATRIX_VALUES] {
    let half = radians / 2.0;
    let mut quaternion = [0.0, 0.0, 0.0, half.cos()];
    quaternion[axis] = half.sin();
    rotation_matrix(quaternion)
}

/// Rotation of `radians` around an arbitrary axis, by Rodrigues' formula: an axis with no usable
/// length rotates nothing rather than carrying `NaN`. The Alembic driver's.
pub fn axis_angle(axis: [f64; 3], radians: f64) -> [f64; MATRIX_VALUES] {
    let norm = crate::vec3::length(axis);
    if !norm.is_finite() || norm < 1e-12 {
        return IDENTITY;
    }
    let unit = axis.map(|value| value / norm);
    let (sin, cos) = radians.sin_cos();
    let rest = 1.0 - cos;
    let mut out = IDENTITY;
    for column in 0..3 {
        for row in 0..3 {
            let shared = unit[row] * unit[column] * rest;
            let turn = unit[(6 - row - column) % 3] * sin;
            out[column * 4 + row] = match (3 + row - column) % 3 {
                0 => cos + shared,
                1 => shared + turn,
                _ => shared - turn,
            };
        }
    }
    out
}

/// The unit quaternion `(x, y, z, w)` of a rotation given by its columns `r` (element `(row,
/// col)` is `r[col][row]`), on the branch of the largest of the trace and the diagonal.
pub fn rotation_quaternion(r: [[f64; 3]; 3]) -> [f64; 4] {
    let e = |row: usize, col: usize| r[col][row];
    let trace = e(0, 0) + e(1, 1) + e(2, 2);
    if trace > 0.0 {
        let k = 0.5 / (trace + 1.0).sqrt();
        [
            (e(2, 1) - e(1, 2)) * k,
            (e(0, 2) - e(2, 0)) * k,
            (e(1, 0) - e(0, 1)) * k,
            0.25 / k,
        ]
    } else if e(0, 0) > e(1, 1) && e(0, 0) > e(2, 2) {
        let k = 2.0 * (1.0 + e(0, 0) - e(1, 1) - e(2, 2)).sqrt();
        [
            0.25 * k,
            (e(0, 1) + e(1, 0)) / k,
            (e(0, 2) + e(2, 0)) / k,
            (e(2, 1) - e(1, 2)) / k,
        ]
    } else if e(1, 1) > e(2, 2) {
        let k = 2.0 * (1.0 + e(1, 1) - e(0, 0) - e(2, 2)).sqrt();
        [
            (e(0, 1) + e(1, 0)) / k,
            0.25 * k,
            (e(1, 2) + e(2, 1)) / k,
            (e(0, 2) - e(2, 0)) / k,
        ]
    } else {
        let k = 2.0 * (1.0 + e(2, 2) - e(0, 0) - e(1, 1)).sqrt();
        [
            (e(0, 2) + e(2, 0)) / k,
            (e(1, 2) + e(2, 1)) / k,
            0.25 * k,
            (e(1, 0) - e(0, 1)) / k,
        ]
    }
}

#[cfg(test)]
#[path = "rotation_tests.rs"]
mod tests;
