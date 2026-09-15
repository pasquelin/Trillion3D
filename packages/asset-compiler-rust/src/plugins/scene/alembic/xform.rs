//! La transformation locale d'un `Xform`, de la pile d'opérations d'Alembic à la matrice du glTF.
//!
//! Un `Xform` déclare une suite d'opérations — `.ops`, un octet chacune — et la file de leurs
//! valeurs — `.vals`, des flottants doubles. Les quatre bits de poids **fort** de l'octet disent
//! l'opération : mise à l'échelle, translation, rotation d'axe et d'angle, matrice complète,
//! rotation autour de X, de Y ou de Z. Les bits de poids faible sont un indice d'écriture pour
//! l'éditeur qui a produit le fichier ; ils ne changent ni les valeurs ni leur ordre.
//!
//! Alembic écrit ses matrices dans la convention d'Imath — vecteur en ligne, `v' = v·M`, rangée en
//! lignes — et le glTF dans la convention inverse — vecteur en colonne, `v' = M·v`, rangée en
//! colonnes. Les deux inversions se compensent exactement : la suite de seize nombres est la même
//! des deux côtés, et la matrice d'une opération `matrix` entre donc telle quelle. La composition
//! suit la même règle : `M = op₀ · op₁ · … · opₙ` en colonnes, ce qui applique la dernière opération
//! écrite en premier — l'ordre d'Alembic, où une pile translation, rotation, échelle met bien à
//! l'échelle avant de tourner puis de déplacer.
use super::VALUES_INVALID;
use crate::{CompilerError, Result};

/// Une matrice `4 × 4`, rangée en colonnes comme le glTF l'attend.
pub(super) type Matrix = [f64; 16];

pub(super) const IDENTITY: Matrix = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// Le nombre de valeurs que chaque opération consomme, par code d'opération.
fn arity(code: u8) -> Option<usize> {
    match code >> 4 {
        0 | 1 => Some(3),
        2 => Some(4),
        3 => Some(16),
        4..=6 => Some(1),
        _ => None,
    }
}

/// La matrice d'une opération et de ses valeurs.
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

/// La matrice locale que cette pile d'opérations compose.
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

/// Le produit de deux matrices rangées en colonnes.
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

/// La rotation d'angle `degrees` autour de l'axe donné, par la formule de Rodrigues. Un axe de
/// longueur nulle ne tourne rien : la matrice reste l'identité plutôt que de porter des `NaN`.
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

/// La matrice est-elle utilisable comme transformation d'un nœud ?
pub(super) fn is_finite(matrix: &Matrix) -> bool {
    matrix.iter().all(|value| value.is_finite())
}
