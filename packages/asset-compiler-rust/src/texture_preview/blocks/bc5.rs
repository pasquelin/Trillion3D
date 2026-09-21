//! BC5 block writer: two BC4 channels, X then Y of a normal map, each a byte
//! pair of endpoints and sixteen 3-bit ranks on the eight-point ladder every
//! decoder rebuilds as `(e0 · (7 − r) + e1 · r) / 7`. Each channel has its own
//! segment, which is what a normal map needs: X and Y vary in directions of
//! their own, and one RGBA segment (BC7 mode 6) cannot hold both. The
//! eight-point ladder needs the first endpoint above the second, so the pair is
//! written high to low and the ranks mirrored — the same block either way.
use super::fit::{assign, fit, segment, Endpoints, Texels};

/// Rank `r` of eight weighs `r / 7`, over 64 to share `ladder_of`'s unit.
const LADDER: [f32; 8] = [
    0.0,
    1.0 / 7.0,
    2.0 / 7.0,
    3.0 / 7.0,
    4.0 / 7.0,
    5.0 / 7.0,
    6.0 / 7.0,
    1.0,
];

/// Index a rank names in the eight-point mode: the endpoints themselves are
/// indices 0 and 1, the six interpolated values follow in order.
fn index_of(rank: u8) -> u64 {
    match rank {
        0 => 0,
        7 => 1,
        r => u64::from(r) + 1,
    }
}

/// One BC4 block of `channel`: the endpoints rounded to bytes, the ranks
/// reassigned on what decodes.
fn channel_block(texels: &Texels, channel: usize) -> [u8; 8] {
    let alone: Texels = texels.map(|t| [t[channel], 0.0, 0.0, 0.0]);
    let fitted: Endpoints = fit(&alone, &LADDER, segment(&alone));
    let (mut e0, mut e1) = (
        fitted.0[0].round().clamp(0.0, 255.0) as u8,
        fitted.1[0].round().clamp(0.0, 255.0) as u8,
    );
    let mut rank = assign(
        &alone,
        &LADDER,
        [f32::from(e0), 0.0, 0.0, 0.0],
        [f32::from(e1), 0.0, 0.0, 0.0],
    );
    if e0 < e1 {
        std::mem::swap(&mut e0, &mut e1);
        rank = rank.map(|r| 7 - r);
    }
    let mut bits = u64::from(e0) | u64::from(e1) << 8;
    for (texel, &r) in rank.iter().enumerate() {
        // A flat pair decodes on the six-point ladder, whose index 1 is still `e1`.
        let index = if e0 == e1 { 0 } else { index_of(r) };
        bits |= index << (16 + 3 * texel);
    }
    bits.to_le_bytes()
}

/// Writes the block: X in the first channel, Y in the second.
pub fn encode(texels: &Texels) -> [u8; 16] {
    let mut block = [0u8; 16];
    block[..8].copy_from_slice(&channel_block(texels, 0));
    block[8..].copy_from_slice(&channel_block(texels, 1));
    block
}
