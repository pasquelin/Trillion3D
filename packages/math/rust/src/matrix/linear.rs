//! The linear part of a column-major 4×4 matrix in `f64`: its columns, its determinant, the
//! stretch, the cofactor that carries plane normals, and the translation, rotation
//! and scale it is made of. Two determinants round apart and keep apart: `determinant`, the
//! triple product, and `determinant_by_first_row`, the cofactor expansion along the first row.

use crate::matrix::rotation::rotation_quaternion;
use crate::matrix::MATRIX_VALUES;
use crate::scalar::acos::acos;
use crate::scalar::not_above;
use crate::scalar::trig::sin;
use crate::vector::vec3::{cross, divide};
use crate::vector::vecn::{dot, length};

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

/// The largest singular value of the linear part, `maxStretch` of `packages/math/src/projection/
/// projectionOracles.ts` term for term: the largest eigenvalue of `AᵀA` by the trigonometric
/// solution of its cubic, its arc cosine `acos` and its cosine `sin(π/2 − θ)` fdlibm's, the same
/// bits on every host (the TS form's `Math.cos` may differ in the last bits). Exact for a rotation and a scale, never below the stretch under a shear:
/// the one stretch every level of detail projects an error through. NaN for a non-finite part.
pub fn max_stretch(m: &[f64; MATRIX_VALUES]) -> f64 {
    let [c0, c1, c2] = linear_columns(m);
    if [c0, c1, c2].iter().flatten().any(|v| !v.is_finite()) {
        return f64::NAN;
    }
    let (m00, m11, m22) = (dot(c0, c0), dot(c1, c1), dot(c2, c2));
    let (m01, m02, m12) = (dot(c0, c1), dot(c0, c2), dot(c1, c2));
    let off = m01 * m01 + m02 * m02 + m12 * m12;
    if off <= 0.0 {
        return m00.max(m11).max(m22).max(0.0).sqrt();
    }
    let mean = (m00 + m11 + m22) / 3.0;
    let (d0, d1, d2) = (m00 - mean, m11 - mean, m22 - mean);
    let spread = ((d0 * d0 + d1 * d1 + d2 * d2 + 2.0 * off) / 6.0).sqrt();
    if not_above(spread, 0.0) {
        return mean.max(0.0).sqrt();
    }
    let (b00, b11, b22) = (d0 / spread, d1 / spread, d2 / spread);
    let (b01, b02, b12) = (m01 / spread, m02 / spread, m12 / spread);
    let det = b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02)
        + b02 * (b01 * b12 - b11 * b02);
    let angle = acos((det / 2.0).clamp(-1.0, 1.0)) / 3.0;
    (mean + 2.0 * spread * sin(std::f64::consts::FRAC_PI_2 - angle))
        .max(0.0)
        .sqrt()
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
mod tests;
