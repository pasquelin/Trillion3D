//! Plane vectors on `[f64; 2]`.

/// `√(x² + y²)`, the plain root of the two squares (`js::hypot` scales first and rounds apart).
#[inline]
pub fn length(a: [f64; 2]) -> f64 {
    (a[0] * a[0] + a[1] * a[1]).sqrt()
}

#[inline]
pub fn sub(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] - b[0], a[1] - b[1]]
}

/// The plane cross product `a₀b₁ − a₁b₀`: twice the signed area of the triangle `a` and `b` close
/// with the origin.
#[inline]
pub fn cross(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

/// Twice the signed area of the triangle `a, b, c`, `cross(b − a, c − a)`: positive when it turns
/// counter-clockwise, so the side of the line `a → b` that `c` falls on.
#[inline]
pub fn double_area(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    cross(sub(b, a), sub(c, a))
}

/// The barycentric weights `(v, w)` of `b` and `c` at `p` in the triangle `a, b, c`, whose
/// `double_area` is `area`: `cross(p − a, c − a) / area` and `cross(b − a, p − a) / area`. The
/// weight of `a` is `1 − v − w`.
#[inline]
pub fn barycentric(a: [f64; 2], b: [f64; 2], c: [f64; 2], p: [f64; 2], area: f64) -> [f64; 2] {
    [
        cross(sub(p, a), sub(c, a)) / area,
        cross(sub(b, a), sub(p, a)) / area,
    ]
}

#[cfg(test)]
#[path = "vec2_tests.rs"]
mod tests;
