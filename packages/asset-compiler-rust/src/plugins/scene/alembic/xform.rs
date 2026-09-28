//! Local transform of an `Xform`, from Alembic's operation stack to the glTF matrix.
//!
//! An `Xform` declares a sequence of operations — `.ops`, one byte each — and the queue of their
//! values — `.vals`, double floats. The four **high** bits of the byte name the operation: scale,
//! translation, axis-angle rotation, full matrix, rotation around X, Y or Z. The low bits are a
//! write hint for the editor that produced the file; they change neither the values nor their
//! order.
//!
//! Alembic writes its matrices in the Imath convention — row vector, `v' = v·M`, stored in rows
//! — and glTF in the inverse convention — column vector, `v' = M·v`, stored in columns. The two
//! inversions cancel exactly: the sequence of sixteen numbers is the same on both sides, so a
//! `matrix` operation's matrix enters as-is. Composition follows the same rule: `M = op₀ · op₁
//! · … · opₙ` in columns, which applies the last written operation first — Alembic's order,
//! where a translation, rotation, scale stack scales before rotating then translating.
use super::VALUES_INVALID;
pub(super) use crate::compiler_world::IDENTITY;
use crate::compiler_world::{axis_angle, multiply, scaling, translation, Mat4};
use crate::{CompilerError, Result};

/// How many values each operation consumes, by operation code.
fn arity(code: u8) -> Option<usize> {
    match code >> 4 {
        0 | 1 => Some(3),
        2 => Some(4),
        3 => Some(16),
        4..=6 => Some(1),
        _ => None,
    }
}

/// The matrix of one operation and its values.
fn operation(code: u8, values: &[f64]) -> Option<Mat4> {
    let axis = |x: f64, y: f64, z: f64, degrees: f64| axis_angle([x, y, z], degrees.to_radians());
    match (code >> 4, values) {
        (0, [x, y, z]) => Some(scaling([*x, *y, *z])),
        (1, [x, y, z]) => Some(translation([*x, *y, *z])),
        (2, [x, y, z, degrees]) => Some(axis(*x, *y, *z, *degrees)),
        (3, _) => values.try_into().ok(),
        (4, [degrees]) => Some(axis(1.0, 0.0, 0.0, *degrees)),
        (5, [degrees]) => Some(axis(0.0, 1.0, 0.0, *degrees)),
        (6, [degrees]) => Some(axis(0.0, 0.0, 1.0, *degrees)),
        _ => None,
    }
}

/// The local matrix this operation stack composes.
pub(super) fn matrix(ops: &[u8], values: &[f64]) -> Result<Mat4> {
    let mut out = IDENTITY;
    let mut at = 0usize;
    for code in ops {
        let count = arity(*code).ok_or_else(|| {
            CompilerError::new(
                VALUES_INVALID,
                format!(
                    "alembic: xform operation {code} is not one of the seven the format defines"
                ),
            )
        })?;
        let taken = values.get(at..at + count).ok_or_else(|| {
            CompilerError::new(
                VALUES_INVALID,
                "alembic: an xform declares more operations than it carries values",
            )
        })?;
        let step = operation(*code, taken).ok_or_else(|| {
            CompilerError::new(VALUES_INVALID, "alembic: an xform operation is malformed")
        })?;
        out = multiply(&out, &step);
        at += count;
    }
    Ok(out)
}

/// Is the matrix usable as a node's transform?
pub(super) fn is_finite(matrix: &Mat4) -> bool {
    matrix.iter().all(|value| value.is_finite())
}
