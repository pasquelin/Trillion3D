//! The linear part of a column-major 4×4 matrix in `f64`: its columns, its determinant, the
//! lengths of its columns, the cofactor that carries plane normals, and the translation, rotation
//! and scale it is made of. Two determinants round apart and keep apart: `determinant`, the
//! triple product, and `determinant_by_first_row`, the cofactor expansion along the first row.

use crate::matrix::MATRIX_VALUES;
use crate::rotation::rotation_quaternion;
use crate::vec3::{cross, divide, dot, length};

/// The three columns of the linear part.
#[inline]
pub fn linear_columns(m: &[f64; MATRIX_VALUES]) -> [[f64; 3]; 3] {
    [0, 1, 2].map(|c| [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]])
}

/// The determinant of the linear part as the triple product `c₀ · (c₁ × c₂)`.
#[inline]
pub fn determinant(m: &[f64; MATRIX_VALUES]) -> f64 {
    let [c0, c1, c2] = linear_columns(m);
    dot(c0, cross(c1, c2))
}

/// The determinant of the linear part expanded along its first row,
/// `(c₀ₓ·(c₁ᵧc₂₂ − c₁₂c₂ᵧ) − c₁ₓ·(c₀ᵧc₂₂ − c₀₂c₂ᵧ)) + c₂ₓ·(c₀ᵧc₁₂ − c₀₂c₁ᵧ)`.
#[inline]
pub fn determinant_by_first_row(m: &[f64; MATRIX_VALUES]) -> f64 {
    let [c0, c1, c2] = linear_columns(m);
    c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) - c1[0] * (c0[1] * c2[2] - c0[2] * c2[1])
        + c2[0] * (c0[1] * c1[2] - c0[2] * c1[1])
}

/// Equivalent uniform scale: the cube root of the volume the linear part multiplies, `|det|^⅓`
/// (`determinant`). A non-uniform matrix gives the geometric mean of its three scales, a mirror
/// the scale of its reflection, a degenerate one zero.
#[inline]
pub fn uniform_scale(m: &[f64; MATRIX_VALUES]) -> f64 {
    determinant(m).abs().cbrt()
}

/// The longest of the three columns (`vec3::length` each), from `0.0` by `f64::max` in column
/// order: a NaN length is passed over.
#[inline]
pub fn longest_column(m: &[f64; MATRIX_VALUES]) -> f64 {
    linear_columns(m)
        .map(length)
        .into_iter()
        .fold(0.0f64, f64::max)
}

/// Cofactor of the linear part applied to a direction: `cof(A)·n` is `det(A) · A⁻ᵀn`, so it points
/// the transformed plane normal without ever dividing, and its length is the factor an area of that
/// plane is multiplied by.
#[inline]
pub fn cofactor_direction(m: &[f64; MATRIX_VALUES], normal: [f64; 3]) -> [f64; 3] {
    let [a0, a1, a2] = linear_columns(m);
    let (c0, c1, c2) = (cross(a1, a2), cross(a2, a0), cross(a0, a1));
    [
        normal[0] * c0[0] + normal[1] * c1[0] + normal[2] * c2[0],
        normal[0] * c0[1] + normal[1] * c1[1] + normal[2] * c2[1],
        normal[0] * c0[2] + normal[1] * c1[2] + normal[2] * c2[2],
    ]
}

/// Translation, unit quaternion `(x, y, z, w)` and scale of `m`, the first scale carrying the sign
/// of `determinant_by_first_row`; `None` when a scale is zero or not finite, or when the dot
/// product of two unit columns exceeds `1e-4` in magnitude: a shear, which no such triple carries.
pub fn decompose_trs(m: &[f64; MATRIX_VALUES]) -> Option<([f64; 3], [f64; 4], [f64; 3])> {
    let [c0, c1, c2] = linear_columns(m);
    let det = determinant_by_first_row(m);
    let s = [length(c0) * det.signum(), length(c1), length(c2)];
    if s.iter().any(|v| *v == 0.0 || !v.is_finite()) {
        return None;
    }
    let r = [divide(c0, s[0]), divide(c1, s[1]), divide(c2, s[2])];
    if dot(r[0], r[1])
        .abs()
        .max(dot(r[1], r[2]).abs())
        .max(dot(r[0], r[2]).abs())
        > 1e-4
    {
        return None;
    }
    Some(([m[12], m[13], m[14]], rotation_quaternion(r), s))
}

#[cfg(test)]
#[path = "linear_tests.rs"]
mod tests;
