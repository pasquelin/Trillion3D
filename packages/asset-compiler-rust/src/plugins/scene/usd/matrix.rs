//! This driver's 4 × 4 matrices, in glTF's convention: sixteen numbers **column-major**, a point
//! transformed by `M · p`. USD writes its own row-major and transforms by `p · M`, which is the
//! same matrix transposed twice: the sixteen numbers of a USD `matrix4d` are therefore copied
//! as-is, and composing a list of operations is left to right.

/// Identity, composition, translation, scale and the rotations are those the compiler already
/// applies to glTF nodes: repeating them here would only let them diverge.
pub(super) use crate::compiler_world::{
    axis_rotation, multiply as mul, quaternion_wxyz, scaling, translation, Mat4, IDENTITY,
};

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
    mul(&scale, &axis_rotation(0, (-90.0f64).to_radians()))
}
