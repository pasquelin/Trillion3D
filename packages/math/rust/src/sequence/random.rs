//! Seeded integer generators and hashes: the same sequence on every run and every host; the
//! Murmur3 hashes of words (`murmur3_32`, `murmur3_64`).

use crate::GOLDEN;

/// One step of a 64-bit xorshift (13, 7, 17): the state moved and returned.
#[inline]
pub fn xorshift64(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

/// The next number of the 64-bit xorshift in `[0, 1)`, as an exact `f32`: its top 24 bits over
/// 2²⁴.
#[inline]
pub fn xorshift64_unit_f32(state: &mut u64) -> f32 {
    (xorshift64(state) >> 40) as f32 / (1u64 << 24) as f32
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

/// One step of the 32-bit linear congruential generator `x · 196314165 + 907633515`, wrapping,
/// as a number in `[0, 1)`: the new state's top 23 bits the mantissa of a number in `[1, 2)`,
/// less one.
#[inline]
pub fn lcg32_fraction(state: &mut u32) -> f32 {
    *state = state.wrapping_mul(196_314_165).wrapping_add(907_633_515);
    f32::from_bits(0x3F80_0000 | (*state >> 9)) - 1.0
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

/// Murmur3's 32-bit hash of `words`, seed 0: each word mixed into the state in turn, the state
/// finalised.
pub fn murmur3_32(words: &[u32]) -> u32 {
    let mut hash = 0u32;
    for &word in words {
        let mixed = word
            .wrapping_mul(0xcc9e_2d51)
            .rotate_left(15)
            .wrapping_mul(0x1b87_3593);
        hash = (hash ^ mixed)
            .rotate_left(13)
            .wrapping_mul(5)
            .wrapping_add(0xe654_6b64);
    }
    hash ^= hash >> 16;
    hash = hash.wrapping_mul(0x85eb_ca6b);
    hash ^= hash >> 13;
    hash = hash.wrapping_mul(0xc2b2_ae35);
    hash ^ (hash >> 16)
}

/// The 64-bit hash of `words`: each word multiplied, turned left by 31 and multiplied again,
/// folded into the state — XORed in, the state turned left by 27, times five plus a constant —,
/// the state finalised by three shift-XORs between two multiplications (the Murmur3 64-bit
/// rounds and finaliser).
pub fn murmur3_64(words: &[u64]) -> u64 {
    let mut hash = 0u64;
    for &word in words {
        let mixed = word
            .wrapping_mul(0x87c3_7b91_1142_53d5)
            .rotate_left(31)
            .wrapping_mul(0x4cf5_ad43_2745_937f);
        hash ^= mixed;
        hash = hash
            .rotate_left(27)
            .wrapping_mul(5)
            .wrapping_add(0x52dc_e729);
    }
    hash ^= hash >> 33;
    hash = hash.wrapping_mul(0xff51_afd7_ed55_8ccd);
    hash ^= hash >> 33;
    hash = hash.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    hash ^ (hash >> 33)
}

#[cfg(test)]
mod tests;
