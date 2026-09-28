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
//! done anywhere. The file's single floats are composed in the compiler's double-precision matrix
//! algebra, and the world matrix comes back in single precision.
use super::*;
use crate::compiler_world::{axis_angle, axis_rotation, multiply, quaternion_wxyz, Mat4, IDENTITY};

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

/// The world matrix of an object, in Blender space.
pub(super) fn world(object: &At<'_>) -> [f32; 16] {
    composed(object, 0).map(|value| value as f32)
}

fn composed(object: &At<'_>, depth: usize) -> Mat4 {
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
    multiply(&multiply(&composed(&parent, depth + 1), &inverse), &local)
}

/// The local matrix: scale, rotation, translation, in that order.
fn local(object: &At<'_>) -> Mat4 {
    let scale = triple(object, "size", 1.0);
    let delta = if object.has("dscale") {
        triple(object, "dscale", 1.0)
    } else {
        triple(object, "dsize", 1.0)
    };
    let mut matrix = multiply(&rotation(object), &scaling(&scale, &delta));
    let position = triple(object, "loc", 0.0);
    let shift = triple(object, "dloc", 0.0);
    for axis in 0..3 {
        matrix[12 + axis] = position[axis] + shift[axis];
    }
    matrix
}

/// An object's rotation, according to the mode it declares, deferred included.
fn rotation(object: &At<'_>) -> Mat4 {
    let mode = object.int("rotmode", QUATERNION);
    let own = match mode {
        QUATERNION => quaternion_wxyz(quad(object, "quat")),
        AXIS_ANGLE => axis_angle(
            triple(object, "rotAxis", 0.0),
            f64::from(object.float("rotAngle", 0.0)),
        ),
        _ => euler(&triple(object, "rot", 0.0), mode),
    };
    let differed = match mode {
        QUATERNION => quaternion_wxyz(quad(object, "dquat")),
        AXIS_ANGLE => axis_angle(
            triple(object, "drotAxis", 0.0),
            f64::from(object.float("drotAngle", 0.0)),
        ),
        _ => euler(&triple(object, "drot", 0.0), mode),
    };
    multiply(&differed, &own)
}

/// Euler angles of a given order: each axis turns in turn, the first named first.
fn euler(angles: &[f64; 3], mode: i64) -> Mat4 {
    let order = ORDERS[usize::try_from(mode - 1).unwrap_or(0).min(5)];
    let mut matrix = IDENTITY;
    for axis in order.iter().rev() {
        matrix = multiply(&matrix, &axis_rotation(*axis, angles[*axis]));
    }
    matrix
}

fn scaling(scale: &[f64; 3], delta: &[f64; 3]) -> Mat4 {
    let mut matrix = IDENTITY;
    for axis in 0..3 {
        matrix[axis * 4 + axis] = scale[axis] * delta[axis];
    }
    matrix
}

/// A matrix written in place in a field of sixteen floats.
fn square(object: &At<'_>, name: &str) -> Mat4 {
    written(object, name, IDENTITY)
}

fn triple(object: &At<'_>, name: &str, default: f64) -> [f64; 3] {
    written(object, name, [default; 3])
}

/// A quaternion `(w, x, y, z)`, the identity rotation where the file writes none.
fn quad(object: &At<'_>, name: &str) -> [f64; 4] {
    written(object, name, [1.0, 0.0, 0.0, 0.0])
}

/// The floats of a field over `default`, as many as both hold.
fn written<const N: usize>(object: &At<'_>, name: &str, default: [f64; N]) -> [f64; N] {
    let mut out = default;
    for (slot, value) in out.iter_mut().zip(object.floats(name)) {
        *slot = f64::from(value);
    }
    out
}
