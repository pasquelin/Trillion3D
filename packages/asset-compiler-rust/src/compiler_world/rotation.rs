//! The rotations the scene drivers compose their matrices with, each written once, generic over
//! the driver's precision (`Real`): Blender turns in `f32`, the others in `f64`.
use super::{Mat4, IDENTITY};
use trillion3d_math::real::Real;

/// The identity matrix, in the caller's precision.
pub(crate) fn identity<T: Real>() -> [T; 16] {
    let mut out = [T::ZERO; 16];
    for diagonal in 0..4 {
        out[diagonal * 5] = T::ONE;
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
    let (one, two, zero) = (T::ONE, T::TWO, T::ZERO);
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
    let norm = trillion3d_math::vec3::length(axis);
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

    use trillion3d_math::matrix::{multiply_matrix4, multiply_matrix4_from_zero};

    // The Alembic and Blender drivers' product keeps a column of negative zeros negative; the
    // glTF one writes a positive zero there.
    #[test]
    fn the_summed_product_keeps_the_sign_of_a_zero_the_one_from_zero_drops() {
        let mut left = identity::<f64>();
        left[0] = -0.0;
        for step in 1..4 {
            left[step * 4] = -1.0;
        }
        let right = identity::<f64>();
        assert!(multiply_matrix4(&left, &right)[0].is_sign_negative());
        assert!(multiply_matrix4_from_zero(&left, &right)[0].is_sign_positive());
    }

    // A turn from sine and cosine (Blender, USD) rounds apart from the same turn by
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
