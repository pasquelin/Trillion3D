//! This driver's 4 × 4 matrices, in glTF's convention: sixteen numbers **column-major**, a point
//! transformed by `M · p`. USD writes its own row-major and transforms by `p · M`, which is the
//! same matrix transposed twice: the sixteen numbers of a USD `matrix4d` are therefore copied
//! as-is, and composing a list of operations is left to right.

/// Identity, translation, scale and the rotations come from `compiler_world`, which owns them for
/// every driver, and composition from the maths crate: repeating them here would let them diverge.
pub(super) use crate::compiler_world::{
    quaternion_wxyz, scaling, translation, turn, Mat4, IDENTITY,
};
pub(super) use trillion3d_math::matrix::multiply_matrix4_from_zero;

/// Rotation of a quaternion `(w, x, y, z)`, as USD writes it. A length at or under `f64::EPSILON`
/// rotates nothing; a NaN one still divides, as this driver always has.
pub(super) fn orientation(q: [f64; 4]) -> Mat4 {
    quaternion_wxyz(q, |length| length > f64::EPSILON || length.is_nan())
}

/// Uniform scale equivalent of a matrix, the one that carries a local length into world space.
pub(super) use crate::shared_math::uniform_scale;

/// Scene-root matrix: the layer's unit into metres, then the layer's up axis onto glTF's, which
/// is always `Y`. A `Z`-up layer rotates −90° around `X`, sending `(x, y, z)` to `(x, z, −y)`; a
/// `Y`-up layer does not rotate.
pub(super) fn root(meters_per_unit: f64, z_up: bool) -> Mat4 {
    let scale = scaling([meters_per_unit; 3]);
    if !z_up {
        return scale;
    }
    multiply_matrix4_from_zero(&scale, &turn(0, (-90.0f64).to_radians()))
}
