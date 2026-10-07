use super::*;

#[test]
fn the_curve_is_linear_below_its_knee_and_a_power_above() {
    assert_eq!(srgb_to_linear(0.0), 0.0);
    assert_eq!(srgb_to_linear(1.0), 1.0);
    assert_eq!(srgb_to_linear(0.04045), 0.04045 / 12.92);
    assert_eq!(srgb_to_linear(0.5), (0.555f64 / 1.055).powf(2.4));
    assert_eq!(srgb_to_linear_f32(1.0), 1.0);
    assert_eq!(srgb_to_linear_f32(0.02), 0.02f32 / 12.92);
}

#[test]
fn the_two_precisions_round_apart_on_most_bytes() {
    let apart = (0..=255u8)
        .filter(|&byte| {
            let wide = srgb_to_linear(byte as f64 / 255.0) as f32;
            wide != srgb_to_linear_f32(byte as f32 / 255.0)
        })
        .count();
    assert_eq!(apart, 214);
}

#[test]
fn encoding_inverts_the_curve_on_every_byte() {
    for byte in 0..=255u8 {
        let linear = srgb_to_linear_f32(byte as f32 / 255.0);
        let encoded = linear_to_srgb_f32(linear);
        assert_eq!((encoded.clamp(0.0, 1.0) * 255.0).round() as u8, byte);
    }
    assert_eq!(linear_to_srgb_f32(0.001), 0.001 * 12.92);
}
