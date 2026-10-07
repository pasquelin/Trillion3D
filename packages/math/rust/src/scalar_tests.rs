use super::*;

#[test]
fn lerp_is_exact_at_its_start() {
    assert_eq!(lerp(0.1f64, 0.7, 0.0), 0.1);
    assert_eq!(lerp(2.0f32, 6.0, 0.25), 3.0);
    let (a, b, t) = (0.1f64, 0.7, 0.3);
    assert_eq!(lerp(a, b, t).to_bits(), (a + (b - a) * t).to_bits());
}

#[test]
fn mix_is_exact_at_both_ends_and_rounds_apart_from_lerp() {
    let (a, b) = (0.1f64, 0.7);
    assert_eq!(mix(a, b, 0.0), a);
    assert_eq!(mix(a, b, 1.0), b);
    let apart = (1..100)
        .map(|i| i as f64 / 100.0)
        .filter(|&t| mix(a, b, t) != lerp(a, b, t))
        .count();
    assert!(apart > 0);
    let t = 0.37;
    assert_eq!(mix(a, b, t).to_bits(), (a * (1.0 - t) + b * t).to_bits());
}

#[test]
fn remap_places_a_value_between_its_bounds_unclamped() {
    assert_eq!(remap(5.0f64, 0.0, 10.0), 0.5);
    assert_eq!(remap(15.0f64, 10.0, 20.0), 0.5);
    assert_eq!(remap(-10.0f32, 0.0, 10.0), -1.0);
}

#[test]
fn unit_to_byte_clamps_scales_and_rounds() {
    assert_eq!(unit_to_byte(0.0), 0);
    assert_eq!(unit_to_byte(1.0), 255);
    assert_eq!(unit_to_byte(-3.0), 0);
    assert_eq!(unit_to_byte(7.0), 255);
    assert_eq!(unit_to_byte(0.5), 128);
    assert_eq!(unit_to_byte(f64::NAN), 0);
    assert_eq!(unit_to_byte_f32(0.5), 128);
    assert_eq!(unit_to_byte_f32(2.0 / 255.0), 2);
    assert_eq!(unit_to_byte_f32(f32::NAN), 0);
    // The byte widens unchanged: `as u32` of the rounded float and of the byte agree.
    for i in 0..=1000 {
        let v = i as f64 / 1000.0;
        assert_eq!(
            unit_to_byte(v) as u32,
            (v.clamp(0.0, 1.0) * 255.0).round() as u32
        );
    }
}

#[test]
fn hermite_basis_sums_to_one_on_values_and_meets_both_ends() {
    assert_eq!(hermite_basis(0.0), [1.0, 0.0, 0.0, 0.0]);
    assert_eq!(hermite_basis(1.0), [0.0, 0.0, 1.0, 0.0]);
    assert_eq!(hermite_basis(0.5), [0.5, 0.125, 0.5, -0.125]);
    let w = 0.3;
    let (w2, w3) = (w * w, w * w * w);
    assert_eq!(
        hermite_basis(w),
        [
            2.0 * w3 - 3.0 * w2 + 1.0,
            w3 - 2.0 * w2 + w,
            -2.0 * w3 + 3.0 * w2,
            w3 - w2
        ]
    );
}

#[test]
fn hermite_follows_values_and_tangents() {
    let basis = hermite_basis(0.5);
    assert_eq!(hermite(basis, 2.0, [1.0, 0.0, 3.0, 0.0]), 2.0);
    // A line through its tangents is its own spline.
    assert_eq!(hermite(basis, 2.0, [0.0, 1.0, 2.0, 1.0]), 1.0);
    let ([a, b, c, d], span, [p0, m0, p1, m1]) = (hermite_basis(0.3), 0.7, [0.1, 0.2, 0.3, 0.4]);
    assert_eq!(
        hermite([a, b, c, d], span, [p0, m0, p1, m1]).to_bits(),
        (a * p0 + b * span * m0 + c * p1 + d * span * m1).to_bits()
    );
}

#[test]
fn mean_sums_in_order_from_negative_zero_and_divides() {
    assert_eq!(mean([1.0, 2.0, 6.0]), 3.0);
    assert!(mean([-0.0]).is_sign_negative());
    assert!(mean(core::iter::empty()).is_nan());
    let values = [0.1, 0.7, 0.33, 1e-9];
    assert_eq!(mean(values), values.iter().sum::<f64>() / 4.0);
    let texels = [17.0f32, 3.5, 255.0, 0.25, 9.0, 1.0, 2.0, 100.0];
    assert_eq!(mean_f32(texels), texels.iter().sum::<f32>() / 8.0);
}
