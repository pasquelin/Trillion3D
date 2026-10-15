//! This driver's 4 × 4 matrices, in glTF's convention: sixteen numbers **column-major**, a point
//! transformed by `M · p`. USD writes its own row-major and transforms by `p · M`, which is the
//! same matrix transposed twice: the sixteen numbers of a USD `matrix4d` are therefore copied
//! as-is, and composing a list of operations is left to right.

// Identity, translation, scale, the rotations and composition come from the maths crate, where
// this driver's other modules import them too: repeating them here would let them diverge.
use crate::compiler_world::Mat4;
use trillion3d_math::rotation::quaternion_wxyz;

/// Rotation of a quaternion `(w, x, y, z)`, as USD writes it. A length at or under `f64::EPSILON`
/// rotates nothing; a NaN one still divides, as this driver always has.
pub(super) fn orientation(q: [f64; 4]) -> Mat4 {
    quaternion_wxyz(q, |length| length > f64::EPSILON || length.is_nan())
}
