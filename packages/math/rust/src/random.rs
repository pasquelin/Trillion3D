//! Seeded integer generators and hashes: the same sequence on every run and every host.

use crate::GOLDEN;

/// One step of a 64-bit xorshift (13, 7, 17): the state moved and returned.
#[inline]
pub fn xorshift64(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

/// One step of a 32-bit xorshift (13, 17, 5): the state moved and returned.
#[inline]
pub fn xorshift32(state: &mut u32) -> u32 {
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    *state
}

/// One step of the 32-bit linear congruential generator `x · 1664525 + 1013904223`, wrapping:
/// the state moved and returned.
#[inline]
pub fn lcg32(state: &mut u32) -> u32 {
    *state = state.wrapping_mul(1664525).wrapping_add(1013904223);
    *state
}

/// `x` mixed by the SplitMix64 finaliser into `[0, 1)`: its top 53 bits, exact in an `f64` (all
/// 64 would round up to `1` near `u64::MAX`).
#[inline]
pub fn splitmix_unit(x: u64) -> f64 {
    let x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    let x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    ((x ^ (x >> 31)) >> 11) as f64 / (1u64 << 53) as f64
}

/// The next number in `[0, 1)` of the SplitMix64 sequence: the state stepped by `GOLDEN`, then
/// `splitmix_unit` of it.
#[inline]
pub fn splitmix_draw(state: &mut u64) -> f64 {
    *state = state.wrapping_add(GOLDEN);
    splitmix_unit(*state)
}

/// The multiplier of `hash_word`.
pub const WORD_HASH_MULTIPLIER: u64 = 0x517c_c1b7_2722_0a95;

/// One word folded into a multiplicative hash: the state turned left by five, `word` XORed in,
/// the whole times `WORD_HASH_MULTIPLIER`, wrapping.
#[inline]
pub fn hash_word(state: u64, word: u64) -> u64 {
    (state.rotate_left(5) ^ word).wrapping_mul(WORD_HASH_MULTIPLIER)
}

#[cfg(test)]
#[path = "random_tests.rs"]
mod tests;
