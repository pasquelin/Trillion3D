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
use crate::{CompilerError, Result};

/// A `4 × 4` matrix, stored in columns as glTF expects.
pub(super) type Matrix = [f64; 16];

pub(super) const IDENTITY: Matrix = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

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
fn operation(code: u8, values: &[f64]) -> Option<Matrix> {
    let axis = |x: f64, y: f64, z: f64, degrees: f64| rotation([x, y, z], degrees);
    match (code >> 4, values) {
        (0, [x, y, z]) => Some(scale([*x, *y, *z])),
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
pub(super) fn matrix(ops: &[u8], values: &[f64]) -> Result<Matrix> {
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

/// The product of two matrices stored in columns.
fn multiply(left: &Matrix, right: &Matrix) -> Matrix {
    let mut out = [0.0; 16];
    for column in 0..4 {
        for row in 0..4 {
            out[column * 4 + row] = (0..4)
                .map(|k| left[k * 4 + row] * right[column * 4 + k])
                .sum();
        }
    }
    out
}

fn translation([x, y, z]: [f64; 3]) -> Matrix {
    let mut out = IDENTITY;
    [out[12], out[13], out[14]] = [x, y, z];
    out
}

fn scale([x, y, z]: [f64; 3]) -> Matrix {
    let mut out = IDENTITY;
    [out[0], out[5], out[10]] = [x, y, z];
    out
}

/// Rotation of angle `degrees` around the given axis, by Rodrigues' formula. A zero-length axis
/// rotates nothing: the matrix stays identity rather than carrying `NaN`.
fn rotation(axis: [f64; 3], degrees: f64) -> Matrix {
    let length = axis.iter().map(|value| value * value).sum::<f64>().sqrt();
    if !length.is_finite() || length < 1e-12 {
        return IDENTITY;
    }
    let [x, y, z] = axis.map(|value| value / length);
    let (sin, cos) = degrees.to_radians().sin_cos();
    let rest = 1.0 - cos;
    [
        cos + x * x * rest,
        y * x * rest + z * sin,
        z * x * rest - y * sin,
        0.0,
        x * y * rest - z * sin,
        cos + y * y * rest,
        z * y * rest + x * sin,
        0.0,
        x * z * rest + y * sin,
        y * z * rest - x * sin,
        cos + z * z * rest,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
    ]
}

/// Is the matrix usable as a node's transform?
pub(super) fn is_finite(matrix: &Matrix) -> bool {
    matrix.iter().all(|value| value.is_finite())
}
