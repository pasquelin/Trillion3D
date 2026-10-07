//! Small vector algebra on `[f64; 3]`, shared by the codec's normal cone and minimal ball and every
//! compiler stage that reads geometry: one implementation of each. The `_f32` forms are for the
//! sites that round in single precision on purpose.

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
#[inline]
pub fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
#[inline]
pub fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
#[inline]
pub fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
#[inline]
pub fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
#[inline]
pub fn scale(a: [f64; 3], k: f64) -> [f64; 3] {
    [a[0] * k, a[1] * k, a[2] * k]
}
/// Divides each axis by `k`: not `scale(a, 1.0 / k)`, which rounds once more.
#[inline]
pub fn divide(a: [f64; 3], k: f64) -> [f64; 3] {
    [a[0] / k, a[1] / k, a[2] / k]
}
#[inline]
pub fn length(a: [f64; 3]) -> f64 {
    dot(a, a).sqrt()
}
/// `length` in single precision: `√((x² + y²) + z²)` rounded in `f32`.
#[inline]
pub fn length_f32(a: [f32; 3]) -> f32 {
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt()
}
/// `divide` in single precision.
#[inline]
pub fn divide_f32(a: [f32; 3], k: f32) -> [f32; 3] {
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

/// `normalize`, when `usable` accepts the length; `None` otherwise. The guard is the caller's.
#[inline]
pub fn normalize_where(a: [f64; 3], usable: impl Fn(f64) -> bool) -> Option<[f64; 3]> {
    let norm = length(a);
    usable(norm).then(|| divide(a, norm))
}

/// `normalize` above a length of `1e-12`, `fallback` at or under it, or for a NaN length: a
/// shorter vector carries no direction.
#[inline]
pub fn normalized_or(a: [f64; 3], fallback: [f64; 3]) -> [f64; 3] {
    normalize_where(a, |norm| norm > 1e-12).unwrap_or(fallback)
}

/// `a` times the reciprocal of its length (`scale(a, 1 / length)`), when `usable` accepts that
/// length; `None` otherwise. One rounding more than `normalize_where`: the two give different
/// floats and keep apart.
#[inline]
pub fn unit_where(a: [f64; 3], usable: impl Fn(f64) -> bool) -> Option<[f64; 3]> {
    let norm = length(a);
    usable(norm).then(|| scale(a, 1.0 / norm))
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

/// `normalize` in single precision (`length_f32`, `divide_f32`) for a finite, non-zero length;
/// `None` otherwise.
#[inline]
pub fn normalize_finite_f32(a: [f32; 3]) -> Option<[f32; 3]> {
    let norm = length_f32(a);
    (norm.is_finite() && norm != 0.0).then(|| divide_f32(a, norm))
}

#[cfg(test)]
#[path = "vec3_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "normalize_tests.rs"]
mod normalize_tests;
