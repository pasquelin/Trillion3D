use super::*;

#[test]
fn golden_ratio_is_one_plus_root_five_over_two() {
    assert_eq!(
        GOLDEN_RATIO.to_bits(),
        ((1.0 + 5f64.sqrt()) / 2.0).to_bits()
    );
    assert_eq!(
        (GOLDEN_RATIO * GOLDEN_RATIO - GOLDEN_RATIO - 1.0).abs(),
        0.0
    );
}

#[test]
fn golden_32_is_the_high_half_of_golden() {
    assert_eq!(u64::from(GOLDEN_32), GOLDEN >> 32);
    assert_eq!(5u64.wrapping_mul(u64::from(GOLDEN_32)), 5 * 0x9E37_79B9);
}
