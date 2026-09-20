//! BC7 block writer, mode 6 only: one subset, RGBA endpoints on 7 bits plus one
//! shared low bit each, sixteen 4-bit weights. The mode every BC7 decoder
//! reconstructs with `(e0 · (64 − w) + e1 · w + 32) >> 6` on the weight ladder
//! below — the specification's integer rule, applied here in floating point to
//! choose, then packed bit for bit. Modes with partitions or separate alpha
//! weights are not searched: the batch measures the loss of this single mode
//! and publishes it; a richer search would be a later, measured batch.
use super::fit::{assign, fit, Texels};

/// The 4-bit interpolation weights, over 64.
const WEIGHTS: [u8; 16] = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];

fn ladder() -> [f32; 16] {
    WEIGHTS.map(|w| f32::from(w) / 64.0)
}

/// Quantises an endpoint to 7 bits plus the shared low bit that costs it least
/// over its four channels; returns the 7-bit values, the bit, and what decodes.
/// Choosing the pair of bits on the whole block's error instead was measured on
/// real textures and changed nothing at the tenth of a decibel.
fn quantise(endpoint: [f32; 4]) -> ([u8; 4], u8, [f32; 4]) {
    let mut best: Option<([u8; 4], u8, [f32; 4], f32)> = None;
    for p in 0..2u8 {
        let high: [u8; 4] =
            endpoint.map(|v| (((v - f32::from(p)) / 2.0).round().clamp(0.0, 127.0)) as u8);
        let decoded = high.map(|h| f32::from(h * 2 + p));
        let cost: f32 = decoded
            .iter()
            .zip(endpoint)
            .map(|(d, v)| (d - v) * (d - v))
            .sum();
        if best.as_ref().is_none_or(|b| cost < b.3) {
            best = Some((high, p, decoded, cost));
        }
    }
    let (high, p, decoded, _) = best.expect("two candidates");
    (high, p, decoded)
}

/// Writes the block. The weight of texel 0 must have its high bit clear — the
/// decoder does not store it — so when it is set the endpoints swap and every
/// weight mirrors, which decodes identically.
pub fn encode(texels: &Texels) -> [u8; 16] {
    let ladder = ladder();
    let fitted = fit(texels, &ladder);
    let (mut h0, mut p0, d0) = quantise(fitted.0);
    let (mut h1, mut p1, d1) = quantise(fitted.1);
    let mut rung = assign(texels, &ladder, d0, d1);
    if rung[0] & 8 != 0 {
        std::mem::swap(&mut h0, &mut h1);
        std::mem::swap(&mut p0, &mut p1);
        rung = rung.map(|r| 15 - r);
    }
    let mut bits: u128 = 1 << 6;
    let mut at = 7;
    for channel in 0..4 {
        for value in [h0[channel], h1[channel]] {
            bits |= u128::from(value) << at;
            at += 7;
        }
    }
    bits |= u128::from(p0) << 63 | u128::from(p1) << 64;
    at = 65;
    for (index, &r) in rung.iter().enumerate() {
        bits |= u128::from(r) << at;
        at += if index == 0 { 3 } else { 4 };
    }
    bits.to_le_bytes()
}
