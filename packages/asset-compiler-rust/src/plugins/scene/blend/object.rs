//! The world matrix of a Blender object.
//!
//! Since Blender 4, an object's matrix is no longer written in the file: it is recomputed at
//! open time from position, rotation and scale, their deferred values, and the parent chain.
//! This driver repeats that computation — and, when an older file does write its matrix, it
//! takes it as-is, the SDNA saying which of the two cases applies.
//!
//! Composition, in order: scale, then rotation, then translation; then, if there is a parent,
//! its world matrix and the inverse matrix the object kept at parenting time. Matrices are
//! written column by column, as Blender stores them and as glTF expects them: no transpose is
//! done anywhere. The file's single floats are composed in single precision, with the
//! compiler's shared helpers at that precision: the output bits stay those Blender files have
//! always compiled to.
use super::*;
use crate::compiler_world::{identity, quaternion_wxyz, turn};
use trillion3d_math::matrix::multiply_matrix4;

/// The object type that holds a mesh.
pub(super) const OB_MESH: i64 = 1;
/// Rotation modes: quaternion, six Euler-angle orders, and axis-angle.
const QUATERNION: i64 = 0;
const AXIS_ANGLE: i64 = -1;
const ORDERS: [[usize; 3]; 6] = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
];
/// Maximum depth of a parent chain, cycle included.
const MAX_DEPTH: usize = 64;

type Matrix = [f32; 16];

/// The world matrix of an object, in Blender space.
pub(super) fn world(object: &At<'_>) -> Matrix {
    composed(object, 0)
}

fn composed(object: &At<'_>, depth: usize) -> Matrix {
    for written in ["obmat", "object_to_world"] {
        if object.has(written) {
            return square(object, written);
        }
    }
    let local = local(object);
    if depth >= MAX_DEPTH {
        return local;
    }
    let Some(parent) = object.follow("parent") else {
        return local;
    };
    let inverse = square(object, "parentinv");
    multiply_matrix4(
        &multiply_matrix4(&composed(&parent, depth + 1), &inverse),
        &local,
    )
}

/// The local matrix: scale, rotation, translation, in that order.
fn local(object: &At<'_>) -> Matrix {
    let scale = triple(object, "size", 1.0);
    let delta = if object.has("dscale") {
        triple(object, "dscale", 1.0)
    } else {
        triple(object, "dsize", 1.0)
    };
    let mut matrix = multiply_matrix4(&rotation(object), &scaling(&scale, &delta));
    let position = triple(object, "loc", 0.0);
    let shift = triple(object, "dloc", 0.0);
    for axis in 0..3 {
        matrix[12 + axis] = position[axis] + shift[axis];
    }
    matrix
}

/// An object's rotation, according to the mode it declares, deferred included.
fn rotation(object: &At<'_>) -> Matrix {
    let mode = object.int("rotmode", QUATERNION);
    let own = match mode {
        QUATERNION => quaternion(quad(object, "quat")),
        AXIS_ANGLE => axis_angle(
            &triple(object, "rotAxis", 0.0),
            object.float("rotAngle", 0.0),
        ),
        _ => euler(&triple(object, "rot", 0.0), mode),
    };
    let differed = match mode {
        QUATERNION => quaternion(quad(object, "dquat")),
        AXIS_ANGLE => axis_angle(
            &triple(object, "drotAxis", 0.0),
            object.float("drotAngle", 0.0),
        ),
        _ => euler(&triple(object, "drot", 0.0), mode),
    };
    multiply_matrix4(&differed, &own)
}

/// Euler angles of a given order: each axis turns in turn, the first named first.
fn euler(angles: &[f32; 3], mode: i64) -> Matrix {
    let order = ORDERS[usize::try_from(mode - 1).unwrap_or(0).min(5)];
    let mut matrix = identity();
    for axis in order.iter().rev() {
        matrix = multiply_matrix4(&matrix, &turn(*axis, angles[*axis]));
    }
    matrix
}

/// Rotation of a quaternion written (w, x, y, z), as Blender stores it; one of no finite,
/// non-zero length rotates nothing.
fn quaternion(value: [f32; 4]) -> Matrix {
    quaternion_wxyz(value, |length| length.is_finite() && length != 0.0)
}

/// Rotation of an angle around an arbitrary axis, by the quaternion of its half angle. Blender's
/// own formula, apart from `compiler_world::axis_angle` (Rodrigues) on purpose: it rounds apart.
fn axis_angle(axis: &[f32; 3], angle: f32) -> Matrix {
    let Some([x, y, z]) = normals::unit(*axis) else {
        return identity();
    };
    let half = angle / 2.0;
    let sin = half.sin();
    quaternion([half.cos(), x * sin, y * sin, z * sin])
}

fn scaling(scale: &[f32; 3], delta: &[f32; 3]) -> Matrix {
    let mut matrix = identity();
    for axis in 0..3 {
        matrix[axis * 4 + axis] = scale[axis] * delta[axis];
    }
    matrix
}

/// A matrix written in place in a field of sixteen floats.
fn square(object: &At<'_>, name: &str) -> Matrix {
    written(object, name, identity())
}

fn triple(object: &At<'_>, name: &str, default: f32) -> [f32; 3] {
    written(object, name, [default; 3])
}

/// A quaternion `(w, x, y, z)`, the identity rotation where the file writes none.
fn quad(object: &At<'_>, name: &str) -> [f32; 4] {
    written(object, name, [1.0, 0.0, 0.0, 0.0])
}

/// The floats of a field over `default`, as many as both hold.
fn written<const N: usize>(object: &At<'_>, name: &str, default: [f32; N]) -> [f32; N] {
    let mut out = default;
    for (slot, value) in out.iter_mut().zip(object.floats(name)) {
        *slot = value;
    }
    out
}
