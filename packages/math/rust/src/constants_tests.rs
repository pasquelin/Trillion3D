use super::*;

#[test]
fn golden_32_is_the_high_half_of_golden() {
    assert_eq!(u64::from(GOLDEN_32), GOLDEN >> 32);
    assert_eq!(5u64.wrapping_mul(u64::from(GOLDEN_32)), 5 * 0x9E37_79B9);
}
