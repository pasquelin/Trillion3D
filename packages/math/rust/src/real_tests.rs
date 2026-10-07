use super::*;

/// `Real`'s trigonometry through the trait, for either precision.
fn turned<T: Real>(x: T) -> (T, T, T, (T, T)) {
    (Real::sin(x), Real::cos(x), Real::tan(x), Real::sin_cos(x))
}

#[test]
fn the_trigonometry_is_the_platform_s_in_each_precision() {
    let x = 0.7f64;
    let (sin, cos, tan, (s, c)) = turned(x);
    assert_eq!([sin, cos, tan], [x.sin(), x.cos(), x.tan()]);
    assert_eq!((s, c), x.sin_cos());
    let x = 0.7f32;
    let (sin, cos, tan, pair) = turned(x);
    assert_eq!([sin, cos, tan], [x.sin(), x.cos(), x.tan()]);
    assert_eq!(pair, x.sin_cos());
    assert_eq!(Real::sqrt(9.0f32), 3.0);
}
