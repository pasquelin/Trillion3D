use super::*;

#[test]
fn xorshift64_steps_by_thirteen_seven_seventeen() {
    let mut state = 1u64;
    let first = xorshift64(&mut state);
    let mut x = 1u64;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    assert_eq!((first, state), (x, x));
    assert_eq!(first, 0x4082_2041);
}

#[test]
fn xorshift32_steps_by_thirteen_seventeen_five() {
    let mut state = 0x2545_f491u32;
    let mut x = state;
    for _ in 0..100 {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        assert_eq!(xorshift32(&mut state), x);
        assert_eq!(state, x);
    }
}

#[test]
fn lcg32_is_the_numerical_recipes_step() {
    let mut state = 957u32;
    assert_eq!(lcg32(&mut state), 957 * 1664525 + 1013904223);
    assert_eq!(lcg32(&mut state), state);
    let mut zero = 0u32;
    assert_eq!(lcg32(&mut zero), 1013904223);
}

#[test]
fn splitmix_unit_keeps_the_top_fifty_three_bits_below_one() {
    assert_eq!(splitmix_unit(0), 0.0);
    // The first SplitMix64 output from seed 0 is 0xE220A8397B1DCDAF.
    assert_eq!(
        splitmix_unit(GOLDEN),
        (0xE220_A839_7B1D_CDAFu64 >> 11) as f64 / (1u64 << 53) as f64
    );
    let mut state = 7u64;
    for _ in 0..1000 {
        let x = xorshift64(&mut state);
        let unit = splitmix_unit(x);
        assert!((0.0..1.0).contains(&unit));
    }
}

#[test]
fn splitmix_draw_steps_by_golden_then_mixes() {
    let mut state = 0u64;
    assert_eq!(splitmix_draw(&mut state), splitmix_unit(GOLDEN));
    assert_eq!(state, GOLDEN);
    assert_eq!(
        splitmix_draw(&mut state),
        splitmix_unit(GOLDEN.wrapping_mul(2))
    );
}

#[test]
fn hash_word_turns_xors_and_multiplies() {
    assert_eq!(hash_word(0, 1), WORD_HASH_MULTIPLIER);
    let state = 0x8000_0000_0000_0001u64;
    assert_eq!(
        hash_word(state, 3),
        (0x30u64 ^ 3).wrapping_mul(WORD_HASH_MULTIPLIER)
    );
}
