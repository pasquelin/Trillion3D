use super::*;

#[test]
fn golden_32_is_the_high_half_of_golden() {
    assert_eq!(u64::from(GOLDEN_32), GOLDEN >> 32);
    assert_eq!(5u64.wrapping_mul(u64::from(GOLDEN_32)), 5 * 0x9E37_79B9);
}

#[test]
fn golden_angle_is_pi_times_three_minus_root_five() {
    assert_eq!(GOLDEN_ANGLE, std::f64::consts::PI * (3.0 - 5f64.sqrt()));
}
