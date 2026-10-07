//! Plane vectors on `[f64; 2]`.

/// `√(x² + y²)`, the plain root of the two squares (`js::hypot` scales first and rounds apart).
#[inline]
pub fn length(a: [f64; 2]) -> f64 {
    (a[0] * a[0] + a[1] * a[1]).sqrt()
}
