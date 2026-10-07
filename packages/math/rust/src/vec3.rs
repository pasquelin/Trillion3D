//! Small vector algebra on `[f64; 3]`, shared by the codec's normal cone and minimal ball and every
//! compiler stage that reads geometry: one implementation of each.

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
