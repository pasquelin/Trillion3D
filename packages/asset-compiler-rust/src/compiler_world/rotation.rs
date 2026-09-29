//! The rotations and the summed product the scene drivers compose their matrices with, each
//! written once. Blender composes in single precision, the other drivers in double: the helpers a
//! precision shares are generic over it, so each driver keeps the rounding, and so the output
//! bits, it has always had.
use super::{Mat4, IDENTITY};
use std::iter::Sum;
use std::ops::{Add, Div, Mul, Neg, Sub};

/// A float a matrix is composed in: `f32` or `f64`.
pub(crate) trait Real:
    Copy
    + Default
    + Add<Output = Self>
    + Sub<Output = Self>
    + Mul<Output = Self>
    + Div<Output = Self>
    + Neg<Output = Self>
    + Sum
{
    const ONE: Self;
    const TWO: Self;
    fn sin_cos(self) -> (Self, Self);
    fn sqrt(self) -> Self;
}

macro_rules! real {
    ($float:ty) => {
        impl Real for $float {
            const ONE: Self = 1.0;
            const TWO: Self = 2.0;
            fn sin_cos(self) -> (Self, Self) {
                <$float>::sin_cos(self)
            }
            fn sqrt(self) -> Self {
                <$float>::sqrt(self)
            }
        }
    };
}
real!(f32);
real!(f64);

/// The identity matrix, in the caller's precision.
pub(crate) fn identity<T: Real>() -> [T; 16] {
    let mut out = [T::default(); 16];
    for diagonal in 0..4 {
        out[diagonal * 5] = T::ONE;
    }
    out
}

/// `left · right` by `Iterator::sum`, as the Blender and Alembic drivers compose. The sum starts
/// at `-0.0`, so four negative-zero products stay `-0.0` where `multiply` writes `0.0`.
pub(crate) fn product<T: Real>(left: &[T; 16], right: &[T; 16]) -> [T; 16] {
    let mut out = [T::default(); 16];
    for column in 0..4 {
        for row in 0..4 {
            out[column * 4 + row] = (0..4)
                .map(|step| left[step * 4 + row] * right[column * 4 + step])
                .sum();
        }
    }
    out
}

/// Rotation of `radians` around axis `axis` (0 = X, 1 = Y, 2 = Z), from its sine and cosine, as
/// the Blender and USD drivers turn.
pub(crate) fn turn<T: Real>(axis: usize, radians: T) -> [T; 16] {
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
pub(crate) fn rotation_matrix<T: Real>([x, y, z, w]: [T; 4]) -> [T; 16] {
    let (one, two, zero) = (T::ONE, T::TWO, T::default());
    [
        one - two * (y * y + z * z), two * (x * y + z * w), two * (x * z - y * w), zero,
        two * (x * y - z * w), one - two * (x * x + z * z), two * (y * z + x * w), zero,
        two * (x * z + y * w), two * (y * z - x * w), one - two * (x * x + y * y), zero,
        zero, zero, zero, one,
    ]
}

/// Rotation of a quaternion written `(w, x, y, z)`, divided by its length first. A length
/// `usable` refuses rotates nothing: the guard is each driver's own.
pub(crate) fn quaternion_wxyz<T: Real>(q: [T; 4], usable: impl Fn(T) -> bool) -> [T; 16] {
    let length = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if !usable(length) {
        return identity();
    }
    let [w, x, y, z] = q.map(|part| part / length);
    rotation_matrix([x, y, z, w])
}

/// Rotation of `radians` around axis `axis` (0 = X, 1 = Y, 2 = Z), by its quaternion, as the
/// Maya driver turns.
pub(crate) fn axis_rotation(axis: usize, radians: f64) -> Mat4 {
    let half = radians / 2.0;
    let mut quaternion = [0.0, 0.0, 0.0, half.cos()];
    quaternion[axis] = half.sin();
    rotation_matrix(quaternion)
}

/// Rotation of `radians` around an arbitrary axis, by Rodrigues' formula: an axis with no usable
/// length rotates nothing rather than carrying `NaN`. The Alembic driver's.
pub(crate) fn axis_angle(axis: [f64; 3], radians: f64) -> Mat4 {
    let norm = crate::shared_math::length(axis);
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

#[cfg(test)]
mod tests {
    use super::*;

    // Audit of #940: the summed product keeps a column of negative zeros negative, as the Alembic
    // and Blender drivers always wrote it; `multiply` writes a positive zero there.
    #[test]
    fn the_summed_product_keeps_the_sign_of_a_zero_multiply_drops() {
        let mut left = identity::<f64>();
        left[0] = -0.0;
        for step in 1..4 {
            left[step * 4] = -1.0;
        }
        let right = identity::<f64>();
        assert!(product(&left, &right)[0].is_sign_negative());
        assert!(super::super::multiply(&left, &right)[0].is_sign_positive());
    }

    // Audit of #940: a turn from sine and cosine (Blender, USD) rounds apart from the same turn by
    // its quaternion (Maya): the two stay, each driver keeping its own bits.
    #[test]
    fn a_turn_by_sine_and_cosine_rounds_apart_from_one_by_quaternion() {
        let radians = (-90.0f64).to_radians();
        assert_eq!(turn(0, radians)[5].to_bits(), radians.cos().to_bits());
        assert_ne!(
            turn(0, radians)[5].to_bits(),
            axis_rotation(0, radians)[5].to_bits()
        );
        assert_eq!(turn(2, 0.5f32)[0].to_bits(), 0.5f32.cos().to_bits());
    }
}
