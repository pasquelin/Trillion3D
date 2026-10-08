use super::*;

#[test]
fn the_plain_length_sums_the_squares_in_order_and_divides_each_part() {
    let q = [1.0f64, 2.0, 2.0, 4.0];
    assert_eq!(length_squared(q), 25.0);
    assert_eq!(length(q), 5.0);
    assert_eq!(divide(q, 5.0), [0.2, 0.4, 0.4, 0.8]);
    let f = [3.0f32, 0.0, 4.0, 0.0];
    assert_eq!(length(f), 5.0f32);
    // A product by the reciprocal rounds once more: `divide` does not take it.
    let third = [1.0f64, 0.0, 0.0, 0.0].map(|v| v * 0.1);
    assert_eq!(divide(third, 3.0)[0].to_bits(), (0.1f64 / 3.0).to_bits());
}

#[test]
fn normalize_takes_the_compensated_root_in_range_and_hypot_outside() {
    let mut q = [0.5, -0.5, 0.5, 0.5];
    normalize(&mut q);
    assert_eq!(q, [0.5, -0.5, 0.5, 0.5]);
    // Far below `SQUARED_MIN`: the squares underflow, `Math.hypot` scales first.
    let mut tiny = [1e-160, 0.0, 0.0, 1e-160];
    normalize(&mut tiny);
    assert!((tiny[0] - core::f64::consts::FRAC_1_SQRT_2).abs() < 1e-15);
    // Far above `SQUARED_MAX`: the squares overflow, the same scaled length.
    let mut huge = [1e300, 1e300, 0.0, 0.0];
    normalize(&mut huge);
    assert_eq!(huge[0], huge[1]);
    assert!((huge[0] - core::f64::consts::FRAC_1_SQRT_2).abs() < 1e-15);
    // A zero or NaN length is taken as `1`.
    let mut zero = [0.0, -0.0, 0.0, 0.0];
    normalize(&mut zero);
    assert_eq!(
        zero.map(f64::to_bits),
        [0.0, -0.0, 0.0, 0.0].map(f64::to_bits)
    );
}

#[test]
fn dot_sums_its_four_products_in_order() {
    let (a, b) = ([1e17, 1.0, -1e17, 1.0], [1.0; 4]);
    // `((1e17 + 1) − 1e17) + 1` loses the first `1`: the order is the sum's.
    assert_eq!(dot(a, b), 1.0);
}

#[test]
fn the_arc_takes_the_shorter_side_and_its_weights_end_on_the_keys() {
    let h = core::f64::consts::FRAC_1_SQRT_2;
    let (a, b) = ([0.0, 0.0, 0.0, 1.0], [0.0, -h, 0.0, -h]);
    let arc = slerp_arc(a, b);
    assert_eq!(arc[0], -1.0);
    assert!((arc[1] - core::f64::consts::FRAC_PI_4).abs() < 1e-15);
    assert_eq!(arc[2], crate::trig::sin(arc[1]));
    assert_eq!(slerp_weights(0.0, arc), [1.0, -0.0]);
    let [wa, wb] = slerp_weights(1.0, arc);
    assert!(wa.abs() < 1e-15 && (wb + 1.0).abs() < 1e-15);
    // Equal keys: no arc, the line's weights.
    let flat = slerp_arc(a, a);
    assert_eq!(flat, [1.0, 0.0, 0.0]);
    assert_eq!(slerp_weights(0.25, flat), [0.75, 0.25]);
}
