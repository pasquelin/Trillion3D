//! This driver's 4 × 4 matrices, in glTF's convention: sixteen numbers **column-major**, a point
//! transformed by `M · p`. USD writes its own row-major and transforms by `p · M`, which is the
//! same matrix transposed twice: the sixteen numbers of a USD `matrix4d` are therefore copied
//! as-is, and composing a list of operations is left to right.

/// Identity, composition, translation, scale and quaternion rotation are those the compiler
/// already applies to glTF nodes: repeating them here would only let them diverge.
pub(super) use crate::compiler_world::{
    multiply as mul, rotation_matrix, scaling, translation, Mat4, IDENTITY,
};

/// Uniform scale equivalent of a matrix, the one that carries a local length into world space.
pub(super) use crate::shared_math::uniform_scale;

/// Rotation of `degrees` around axis `axis` (0 = X, 1 = Y, 2 = Z).
pub(super) fn rotation(axis: usize, degrees: f64) -> Mat4 {
    let (sin, cos) = degrees.to_radians().sin_cos();
    let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
    let mut out = IDENTITY;
    out[u * 4 + u] = cos;
    out[u * 4 + v] = sin;
    out[v * 4 + u] = -sin;
    out[v * 4 + v] = cos;
    out
}

/// Rotation of a unit quaternion `(w, x, y, z)`, as USD writes it.
pub(super) fn orientation(q: [f64; 4]) -> Mat4 {
    let length = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if length <= f64::EPSILON {
        return IDENTITY;
    }
    let [w, x, y, z] = q.map(|part| part / length);
    rotation_matrix([x, y, z, w])
}

/// Scene-root matrix: the layer's unit into metres, then the layer's up axis onto glTF's, which
/// is always `Y`. A `Z`-up layer rotates −90° around `X`, sending `(x, y, z)` to `(x, z, −y)`; a
/// `Y`-up layer does not rotate.
pub(super) fn root(meters_per_unit: f64, z_up: bool) -> Mat4 {
    let scale = scaling([meters_per_unit; 3]);
    if !z_up {
        return scale;
    }
    mul(&scale, &rotation(0, -90.0))
}
