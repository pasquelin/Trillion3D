//! La matrice monde d'un objet Blender.
//!
//! Depuis Blender 4, la matrice d'un objet n'est plus écrite dans le fichier : elle est recalculée à
//! l'ouverture depuis la position, la rotation et l'échelle, leurs valeurs différées, et la chaîne
//! des pères. Ce pilote refait ce calcul — et, quand un fichier plus ancien écrit bien sa matrice,
//! il la prend telle quelle, le SDNA disant lequel des deux cas s'applique.
//!
//! Composition, dans l'ordre : l'échelle, puis la rotation, puis la translation ; puis, s'il y a un
//! père, sa matrice monde et la matrice inverse que l'objet a retenue au moment de l'accrochage.
//! Les matrices sont écrites colonne par colonne, comme Blender les range et comme le glTF les
//! attend : aucune transposition n'est faite nulle part.
use super::*;

/// Le type d'objet qui porte un maillage.
pub(super) const OB_MESH: i64 = 1;
/// Modes de rotation : quaternion, six ordres d'angles d'Euler, et axe-angle.
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
/// Profondeur maximale d'une chaîne de pères, cycle compris.
const MAX_DEPTH: usize = 64;

pub(super) type Matrix = [f32; 16];

const IDENTITY: Matrix = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// La matrice monde d'un objet, en repère Blender.
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

/// La matrice locale : échelle, rotation, translation, dans cet ordre.
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

/// La rotation d'un objet, selon le mode qu'il déclare, différée comprise.
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

/// Les angles d'Euler d'un ordre donné : chaque axe tourne à son tour, le premier nommé d'abord.
fn euler(angles: &[f32; 3], mode: i64) -> Matrix {
    let order = ORDERS[usize::try_from(mode - 1).unwrap_or(0).min(5)];
    let mut matrix = IDENTITY;
    for axis in order.iter().rev() {
        matrix = multiply(&matrix, &turn(*axis, angles[*axis]));
    }
    matrix
}

/// La rotation d'un angle autour d'un axe du repère.
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

/// La rotation d'un quaternion écrit (w, x, y, z), comme Blender le range.
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

/// La rotation d'un angle autour d'un axe quelconque.
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

/// Le produit de deux matrices, la première appliquée après la seconde.
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

/// Une matrice écrite en place dans un champ de seize flottants.
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
