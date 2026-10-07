//! Vectors of any width `N`, generic over their precision (`Real`): what `vec3` writes on
//! `[f64; 3]`, for the four-channel texels, the quantised records and the weighted corners. Every
//! sum runs in index order from `−0.0`, which `−0.0 + x` returns bit for bit: the first term
//! alone, as an iterator's `sum` and a written-out `a + b + c` both give it.

use crate::real::Real;

#[inline]
pub fn add<T: Real, const N: usize>(a: [T; N], b: [T; N]) -> [T; N] {
    core::array::from_fn(|i| a[i] + b[i])
}
#[inline]
pub fn sub<T: Real, const N: usize>(a: [T; N], b: [T; N]) -> [T; N] {
    core::array::from_fn(|i| a[i] - b[i])
}
#[inline]
pub fn scale<T: Real, const N: usize>(a: [T; N], k: T) -> [T; N] {
    a.map(|v| v * k)
}
/// The products summed in index order, `((a₀b₀ + a₁b₁) + a₂b₂) + …`.
#[inline]
pub fn dot<T: Real, const N: usize>(a: [T; N], b: [T; N]) -> T {
    (0..N).fold(T::NEG_ZERO, |sum, i| sum + a[i] * b[i])
}
/// `dot(a, a)`.
#[inline]
pub fn squared_length<T: Real, const N: usize>(a: [T; N]) -> T {
    dot(a, a)
}
/// The root of `squared_length`.
#[inline]
pub fn length<T: Real, const N: usize>(a: [T; N]) -> T {
    squared_length(a).sqrt()
}
/// `squared_length(a − b)`.
#[inline]
pub fn distance2<T: Real, const N: usize>(a: [T; N], b: [T; N]) -> T {
    squared_length(sub(a, b))
}
/// `distance2` of integer vectors: each difference squared, summed in index order from `0`.
#[inline]
pub fn distance2_i32<const N: usize>(a: [i32; N], b: [i32; N]) -> i32 {
    (0..N).map(|i| (a[i] - b[i]).pow(2)).sum()
}
/// `a + (b − a) · t` axis by axis: `a` at `t = 0`, exactly.
#[inline]
pub fn lerp<T: Real, const N: usize>(a: [T; N], b: [T; N], t: T) -> [T; N] {
    core::array::from_fn(|i| a[i] + (b[i] - a[i]) * t)
}
/// The points weighted and summed axis by axis, `p₀·w₀ + p₁·w₁ + …` in point order.
#[inline]
pub fn weighted_sum<T: Real, const N: usize, const K: usize>(
    points: [[T; N]; K],
    weights: [T; K],
) -> [T; N] {
    core::array::from_fn(|axis| {
        (0..K).fold(T::NEG_ZERO, |sum, k| sum + points[k][axis] * weights[k])
    })
}
/// `weighted_sum` divided axis by axis by the sum of the weights, both summed in order.
#[inline]
pub fn weighted_mean<T: Real, const N: usize, const K: usize>(
    points: [[T; N]; K],
    weights: [T; K],
) -> [T; N] {
    let total = weights.into_iter().fold(T::NEG_ZERO, |sum, w| sum + w);
    weighted_sum(points, weights).map(|v| v / total)
}
/// The mean of `points`: their sum from `+0.0` axis by axis, times the reciprocal of their count.
/// No point gives NaN.
#[inline]
pub fn mean<const N: usize>(points: impl IntoIterator<Item = [f64; N]>) -> [f64; N] {
    let (sum, count) = points
        .into_iter()
        .fold(([0.0f64; N], 0usize), |(sum, count), p| {
            (add(sum, p), count + 1)
        });
    scale(sum, 1.0 / count as f64)
}

#[cfg(test)]
#[path = "vecn_tests.rs"]
mod tests;
