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
//! done anywhere.
use super::*;

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

pub(super) type Matrix = [f32; 16];

const IDENTITY: Matrix = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// The world matrix of an object, in Blender space.
pub(super) fn world(object: &At<'_>, depth: usize) -> Matrix {
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
    multiply(&multiply(&world(&parent, depth + 1), &inverse), &local)
}

/// The local matrix: scale, rotation, translation, in that order.
fn local(object: &At<'_>) -> Matrix {
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
fn rotation(object: &At<'_>) -> Matrix {
    let mode = object.int("rotmode", QUATERNION);
    let own = match mode {
        QUATERNION => quaternion(&quad(object, "quat")),
        AXIS_ANGLE => axis_angle(
            &triple(object, "rotAxis", 0.0),
            object.float("rotAngle", 0.0),
        ),
        _ => euler(&triple(object, "rot", 0.0), mode),
    };
    let differed = match mode {
        QUATERNION => quaternion(&quad(object, "dquat")),
        AXIS_ANGLE => axis_angle(
            &triple(object, "drotAxis", 0.0),
            object.float("drotAngle", 0.0),
        ),
        _ => euler(&triple(object, "drot", 0.0), mode),
    };
    multiply(&differed, &own)
}

/// Euler angles of a given order: each axis turns in turn, the first named first.
fn euler(angles: &[f32; 3], mode: i64) -> Matrix {
    let order = ORDERS[usize::try_from(mode - 1).unwrap_or(0).min(5)];
    let mut matrix = IDENTITY;
    for axis in order.iter().rev() {
        matrix = multiply(&matrix, &turn(*axis, angles[*axis]));
    }
    matrix
}

/// Rotation of an angle around a space axis.
fn turn(axis: usize, angle: f32) -> Matrix {
    let (sin, cos) = angle.sin_cos();
    let mut matrix = IDENTITY;
    let (first, second) = ((axis + 1) % 3, (axis + 2) % 3);
    matrix[first * 4 + first] = cos;
    matrix[second * 4 + second] = cos;
    matrix[first * 4 + second] = sin;
    matrix[second * 4 + first] = -sin;
    matrix
}

/// Rotation of a quaternion written (w, x, y, z), as Blender stores it.
fn quaternion(value: &[f32; 4]) -> Matrix {
    let (w, x, y, z) = (value[0], value[1], value[2], value[3]);
    let length = (w * w + x * x + y * y + z * z).sqrt();
    if !length.is_finite() || length == 0.0 {
        return IDENTITY;
    }
    let (w, x, y, z) = (w / length, x / length, y / length, z / length);
    let mut matrix = IDENTITY;
    matrix[0] = 1.0 - 2.0 * (y * y + z * z);
    matrix[1] = 2.0 * (x * y + w * z);
    matrix[2] = 2.0 * (x * z - w * y);
    matrix[4] = 2.0 * (x * y - w * z);
    matrix[5] = 1.0 - 2.0 * (x * x + z * z);
    matrix[6] = 2.0 * (y * z + w * x);
    matrix[8] = 2.0 * (x * z + w * y);
    matrix[9] = 2.0 * (y * z - w * x);
    matrix[10] = 1.0 - 2.0 * (x * x + y * y);
    matrix
}

/// Rotation of an angle around an arbitrary axis.
fn axis_angle(axis: &[f32; 3], angle: f32) -> Matrix {
    let length = (axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]).sqrt();
    if !length.is_finite() || length == 0.0 {
        return IDENTITY;
    }
    let half = angle / 2.0;
    let sin = half.sin();
    quaternion(&[
        half.cos(),
        axis[0] / length * sin,
        axis[1] / length * sin,
        axis[2] / length * sin,
    ])
}

fn scaling(scale: &[f32; 3], delta: &[f32; 3]) -> Matrix {
    let mut matrix = IDENTITY;
    for axis in 0..3 {
        matrix[axis * 4 + axis] = scale[axis] * delta[axis];
    }
    matrix
}

/// The product of two matrices, the first applied after the second.
fn multiply(left: &Matrix, right: &Matrix) -> Matrix {
    let mut out = [0.0f32; 16];
    for column in 0..4 {
        for row in 0..4 {
            out[column * 4 + row] = (0..4)
                .map(|step| left[step * 4 + row] * right[column * 4 + step])
                .sum();
        }
    }
    out
}

/// A matrix written in place in a field of sixteen floats.
fn square(object: &At<'_>, name: &str) -> Matrix {
    let values = object.floats(name);
    let mut matrix = IDENTITY;
    for (slot, value) in matrix.iter_mut().zip(values) {
        *slot = value;
    }
    matrix
}

fn triple(object: &At<'_>, name: &str, default: f32) -> [f32; 3] {
    let values = object.floats(name);
    let mut out = [default; 3];
    for (slot, value) in out.iter_mut().zip(values) {
        *slot = value;
    }
    out
}

fn quad(object: &At<'_>, name: &str) -> [f32; 4] {
    let values = object.floats(name);
    let mut out = [1.0, 0.0, 0.0, 0.0];
    for (slot, value) in out.iter_mut().zip(values) {
        *slot = value;
    }
    out
}
