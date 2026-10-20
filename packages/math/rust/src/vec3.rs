//! Small vector algebra on `[f64; 3]`, shared by the codec's normal cone and minimal ball and every
//! compiler stage that reads geometry: one implementation of each. The sum, difference, product by
//! a scalar, dot product and length are `vecn`'s, any width and precision. The `_f32` forms are for
//! the sites that round in single precision on purpose.

use crate::real::Real;
use crate::vecn::{dot, length, scale, squared_length};

/// The first row of the orthonormal frame around the unit `axis`, with no branch on its direction:
/// a unit vector across it, the one every unoriented frame starts from. The sign of `z` picks the
/// hemisphere's formula, so `1/(s + z)` never divides by less than 1 (`frameAcross` of
/// `packages/math/src/vector/frame.ts`, the shader's `frameAround`, term for term).
#[inline]
pub fn frame_across([x, y, z]: [f64; 3]) -> [f64; 3] {
    let s = if z >= 0.0 { 1.0 } else { -1.0 };
    let a = -1.0 / (s + z);
    [1.0 + s * a * x * x, s * (x * y * a), -s * x]
}

/// Vertex `id` of a flat `x, y, z` position array, in float64.
#[inline]
pub fn point(positions: &[f32], id: u32) -> [f64; 3] {
    let i = id as usize * 3;
    [
        positions[i] as f64,
        positions[i + 1] as f64,
        positions[i + 2] as f64,
    ]
}
/// `point`, or `None` when the vertex lies past the end of the array.
#[inline]
pub fn point_checked(positions: &[f32], id: u32) -> Option<[f64; 3]> {
    let i = id as usize * 3;
    positions.get(i + 2).map(|_| point(positions, id))
}
/// The axis of `a`'s largest magnitude; the last among equals.
#[inline]
pub fn dominant_axis(a: [f64; 3]) -> usize {
    (0..3)
        .max_by(|&i, &j| a[i].abs().total_cmp(&a[j].abs()))
        .unwrap_or(0)
}
/// `a × b` in the caller's precision, `[a₁b₂ − a₂b₁, a₂b₀ − a₀b₂, a₀b₁ − a₁b₀]`.
#[inline]
pub fn cross<T: Real>(a: [T; 3], b: [T; 3]) -> [T; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
/// Divides each axis by `k`: not `scale(a, 1.0 / k)`, which rounds once more.
#[inline]
pub fn divide<T: Real>(a: [T; 3], k: T) -> [T; 3] {
    [a[0] / k, a[1] / k, a[2] / k]
}

/// The triple product `a · (b × c)`: the signed volume of the parallelepiped on the three
/// vectors, six times that of their tetrahedron.
#[inline]
pub fn triple(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> f64 {
    dot(a, cross(b, c))
}

/// `a` divided by its length, axis by axis (`divide`), unguarded: a zero vector gives NaN.
#[inline]
pub fn normalize(a: [f64; 3]) -> [f64; 3] {
    divide(a, length(a))
}

/// `normalize` in the caller's precision, when `usable` accepts the length; `None` otherwise. The
/// guard is the caller's.
#[inline]
pub fn normalize_where<T: Real>(a: [T; 3], usable: impl Fn(T) -> bool) -> Option<[T; 3]> {
    let norm = length(a);
    usable(norm).then(|| divide(a, norm))
}

/// `normalize` above a length of `1e-12`, `fallback` at or under it, or for a NaN length: a
/// shorter vector carries no direction.
#[inline]
pub fn normalized_or(a: [f64; 3], fallback: [f64; 3]) -> [f64; 3] {
    normalize_where(a, |norm| norm > 1e-12).unwrap_or(fallback)
}

/// `a` times the reciprocal of its length (`scale(a, 1 / length)`) in the caller's precision, when
/// `usable` accepts that length; `None` otherwise. One rounding more than `normalize_where`: the
/// two give different floats and keep apart.
#[inline]
pub fn unit_where<T: Real>(a: [T; 3], usable: impl Fn(T) -> bool) -> Option<[T; 3]> {
    unit_where_squared(a, |square| usable(square.sqrt()))
}

/// `unit_where`, the guard reading the squared length: a threshold on it decides as written, with
/// no root taken before the comparison.
#[inline]
pub fn unit_where_squared<T: Real>(a: [T; 3], usable: impl Fn(T) -> bool) -> Option<[T; 3]> {
    let square = squared_length(a);
    usable(square).then(|| scale(a, T::ONE / square.sqrt()))
}

/// `unit_where` for a finite, positive length.
#[inline]
pub fn unit(a: [f64; 3]) -> Option<[f64; 3]> {
    unit_where(a, |norm| norm > 0.0 && norm.is_finite())
}

/// `unit_where` for any length but zero: an infinite or NaN length still scales, into NaN.
#[inline]
pub fn unit_unless_zero(a: [f64; 3]) -> Option<[f64; 3]> {
    unit_where(a, |norm| norm > 0.0 || norm.is_nan())
}

/// `unit_unless_zero`, a zero vector returned as it is.
#[inline]
pub fn unit_or_itself(a: [f64; 3]) -> [f64; 3] {
    unit_unless_zero(a).unwrap_or(a)
}

/// `normalize` in single precision (`vecn::length`, `divide`) for a finite, non-zero length;
/// `None` otherwise.
#[inline]
pub fn normalize_finite_f32(a: [f32; 3]) -> Option<[f32; 3]> {
    let norm = length(a);
    (norm.is_finite() && norm != 0.0).then(|| divide(a, norm))
}

#[cfg(test)]
#[path = "vec3_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "normalize_tests.rs"]
mod normalize_tests;
