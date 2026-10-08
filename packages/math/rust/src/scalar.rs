//! Single numbers: interpolations, a range remapped, the unit interval on a byte, Hermite's cubic
//! and means. Two interpolations give different floats and keep apart: `lerp`, `a + (b − a)·t`,
//! exact at `t = 0`; `mix`, `a·(1 − t) + b·t`, exact at both ends.

use crate::real::Real;

/// `a + (b − a) · t`.
#[inline]
pub fn lerp<T: Real>(a: T, b: T, t: T) -> T {
    a + (b - a) * t
}

/// `a · (1 − t) + b · t`.
#[inline]
pub fn mix<T: Real>(a: T, b: T, t: T) -> T {
    a * (T::ONE - t) + b * t
}

/// Where `value` falls between `low` and `high`, `(value − low) / (high − low)`: `0` at `low`, `1`
/// at `high`, not clamped.
#[inline]
pub fn remap<T: Real>(value: T, low: T, high: T) -> T {
    (value - low) / (high - low)
}

/// Half the diagonal of a `width` by `height` rectangle, `hypot(width, height) / 2`.
#[inline]
pub fn half_diagonal(width: f64, height: f64) -> f64 {
    width.hypot(height) / 2.0
}

/// A value of the unit interval on a byte: clamped to `[0, 1]`, times 255, rounded half away from
/// zero; NaN gives `0`.
#[inline]
pub fn unit_to_byte(value: f64) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// `unit_to_byte` in single precision.
#[inline]
pub fn unit_to_byte_f32(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// A byte on the unit interval, `b / 255`.
#[inline]
pub fn byte_to_unit(byte: u8) -> f64 {
    f64::from(byte) / 255.0
}

/// `byte_to_unit` in single precision.
#[inline]
pub fn byte_to_unit_f32(byte: u8) -> f32 {
    f32::from(byte) / 255.0
}

/// The slope `tan(fov / 2)` of a perspective camera's half field, `fov` in degrees: the half
/// height of the image plane one unit ahead.
#[inline]
pub fn perspective_slope(fov_degrees: f64) -> f64 {
    (fov_degrees.to_radians() * 0.5).tan()
}

/// The cubic Hermite basis at `w ∈ [0, 1]`, by `w² = w·w` and `w³ = w²·w`: the weights of the
/// start value `2w³ − 3w² + 1`, of the start tangent `w³ − 2w² + w`, of the end value
/// `−2w³ + 3w²` and of the end tangent `w³ − w²`.
#[inline]
pub fn hermite_basis(w: f64) -> [f64; 4] {
    let w2 = w * w;
    let w3 = w2 * w;
    [
        2.0 * w3 - 3.0 * w2 + 1.0,
        w3 - 2.0 * w2 + w,
        -2.0 * w3 + 3.0 * w2,
        w3 - w2,
    ]
}

/// The cubic Hermite spline of `hermite_basis` `[a, b, c, d]` over an interval `span` long, from
/// the start value and tangent to the end value and tangent:
/// `((a·p₀ + b·span·m₀) + c·p₁) + d·span·m₁`, each tangent per unit of the interval.
#[inline]
pub fn hermite([a, b, c, d]: [f64; 4], span: f64, [p0, m0, p1, m1]: [f64; 4]) -> f64 {
    a * p0 + b * span * m0 + c * p1 + d * span * m1
}

/// The mean of `values`: their sum in order from `−0.0`, as an iterator's `sum` runs, divided by
/// their count. No value gives NaN.
#[inline]
pub fn mean(values: impl IntoIterator<Item = f64>) -> f64 {
    let (sum, count) = values
        .into_iter()
        .fold((-0.0f64, 0usize), |(sum, count), v| (sum + v, count + 1));
    sum / count as f64
}

/// `mean` in single precision.
#[inline]
pub fn mean_f32(values: impl IntoIterator<Item = f32>) -> f32 {
    let (sum, count) = values
        .into_iter()
        .fold((-0.0f32, 0usize), |(sum, count), v| (sum + v, count + 1));
    sum / count as f32
}

#[cfg(test)]
#[path = "scalar_tests.rs"]
mod tests;
