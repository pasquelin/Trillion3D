//! ASTC 4 × 4 block writer, one layout only: a single partition, colour endpoint
//! mode 12 (LDR RGBA, direct), a 4 × 4 weight grid on three bits — eight rungs —
//! and, in the 63 bits that leaves, the eight endpoint values at the 192-level
//! range the decoder infers from that room. Block mode `0x53` names the grid and
//! the weight range; nothing else is searched, and the loss of that one layout is
//! what the batch measures.
//!
//! Endpoint order matters to the decoder: when the first endpoint's RGB sum
//! exceeds the second's it applies "blue contraction" to both. The writer avoids
//! that path by swapping the endpoints and mirroring the weights, which decodes
//! to the same colours.
use super::fit::{assign, fit, ladder_of, Endpoints, Texels};
use super::ise;

/// Block mode: 4 × 4 weights, three bits each, single plane.
const BLOCK_MODE: u128 = 0x53;
/// Colour endpoint mode 12: LDR RGBA, direct.
const CEM: u128 = 12;
/// Where the endpoint data starts for a single partition.
const ENDPOINT_BIT: u32 = 17;
/// The eight rungs a 3-bit weight decodes to, over 64.
const WEIGHTS: [u8; 8] = [0, 9, 18, 27, 37, 46, 55, 64];
pub(super) const LADDER: [f32; 8] = ladder_of(WEIGHTS);

fn quantise(endpoint: [f32; 4]) -> ([u8; 4], [f32; 4]) {
    let levels = endpoint.map(ise::quantise);
    (levels, levels.map(|l| f32::from(ise::unquantise(l))))
}

/// Writes the block.
pub fn encode(texels: &Texels, segment: Endpoints) -> [u8; 16] {
    let fitted = fit(texels, &LADDER, segment);
    let (mut l0, mut d0) = quantise(fitted.0);
    let (mut l1, mut d1) = quantise(fitted.1);
    let sum = |d: [f32; 4]| d[0] + d[1] + d[2];
    let mut rung = assign(texels, &LADDER, d0, d1);
    if sum(d0) > sum(d1) {
        std::mem::swap(&mut l0, &mut l1);
        std::mem::swap(&mut d0, &mut d1);
        rung = rung.map(|r| 7 - r);
    }
    let mut bits = BLOCK_MODE | CEM << 13;
    let mut at = ENDPOINT_BIT;
    let values: [u8; 8] = std::array::from_fn(|i| if i % 2 == 0 { l0[i / 2] } else { l1[i / 2] });
    ise::append(&mut bits, &mut at, &values);
    // Weights are read from the top of the block downward, the first at bit 127.
    for (index, &r) in rung.iter().enumerate() {
        for bit in 0..3 {
            if (r >> bit) & 1 == 1 {
                bits |= 1u128 << (127 - (index as u32 * 3 + bit));
            }
        }
    }
    bits.to_le_bytes()
}
