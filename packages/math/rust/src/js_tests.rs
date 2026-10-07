use super::*;
use std::hint::black_box;

#[test]
fn javascript_min_and_max_keep_nan_and_order_signed_zeros() {
    assert!(js_min(1.0, f64::NAN).is_nan() && js_max(f64::NAN, 0.0).is_nan());
    assert!(js_min(0.0, -0.0).is_sign_negative() && js_min(-0.0, 0.0).is_sign_negative());
    assert!(js_max(0.0, -0.0).is_sign_positive() && js_max(-0.0, 0.0).is_sign_positive());
    assert_eq!(js_min(1.0, 0.25), 0.25);
    assert_eq!(js_max(0.0, -3.0), 0.0);
}

#[test]
fn hypot_rounds_as_javascript_does_where_a_plain_root_does_not() {
    // `Math.hypot` of these three in Node and Chrome; `sqrt` of the squares is one bit higher.
    let (x, y, z) = (0.4471859335899353, -0.1211518868803978, 0.4516414701938629);
    assert_eq!(hypot([x, y, z]).to_bits(), 0x3fe4b46054c7ac11);
    assert_ne!((x * x + y * y + z * z).sqrt().to_bits(), 0x3fe4b46054c7ac11);
    assert_eq!(hypot([-3.0, 4.0, 12.0]), 13.0);
    assert_eq!(hypot([3.0, 4.0, 0.0, 0.0]), 5.0);
    assert_eq!(hypot([0.0, -0.0, 0.0]).to_bits(), 0);
    // An infinity before a NaN, then a NaN before any number, the inputs opaque to the optimiser:
    // the four-value form `anim.rs` carried before returned NaN on the second, once optimised.
    assert_eq!(
        hypot(black_box([f64::NAN, f64::NEG_INFINITY, 1.0])),
        f64::INFINITY
    );
    assert_eq!(
        hypot(black_box([f64::NAN, -1e-320, -4e159, f64::INFINITY])),
        f64::INFINITY
    );
    assert!(hypot(black_box([f64::NAN, 2.0, 1.0])).is_nan());
}

#[test]
fn clamp01_clamps_as_javascript_does() {
    assert_eq!(clamp01(0.25), 0.25);
    assert_eq!(clamp01(-3.0), 0.0);
    assert_eq!(clamp01(7.0), 1.0);
    assert!(clamp01(f64::NAN).is_nan());
    // `Math.max(0, -0)` is `+0`; `f64::clamp` keeps the negative zero.
    assert!(clamp01(-0.0).is_sign_positive());
    assert!((-0.0f64).clamp(0.0, 1.0).is_sign_negative());
}
