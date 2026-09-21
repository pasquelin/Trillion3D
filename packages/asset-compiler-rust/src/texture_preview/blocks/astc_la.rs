//! ASTC 4 × 4 block writer for a normal map: colour endpoint mode 4 (LDR
//! luminance + alpha, direct) on TWO weight planes — the first drives the
//! luminance, which carries X, the second drives the alpha, which carries Y —
//! so each channel climbs its own ladder, as in BC5. The shader reads X in
//! `.r` and Y in `.a`, and rebuilds Z. Block mode `0x452` names the 4 × 4 grid,
//! the dual plane and five-rung quint weights: thirty-two quints take
//! seventy-five bits, the four eight-bit endpoints thirty-two, the plane
//! selector two, the mode, partition and endpoint-mode fields seventeen —
//! one hundred and twenty-six of the block's hundred and twenty-eight.
use super::fit::{assign, fit, segment, Texels};
use super::ise;

/// Block mode: 4 × 4 weights, quints, dual plane.
const BLOCK_MODE: u128 = 0x452;
/// Colour endpoint mode 4: LDR luminance + alpha, direct.
const CEM: u128 = 4;
/// Where the endpoint data starts for a single partition.
const ENDPOINT_BIT: u32 = 17;
/// The second plane drives the alpha channel.
const PLANE_2_CHANNEL: u128 = 3;
/// Bits the thirty-two quint weights take: ten full groups of seven and a
/// group of two on five.
const WEIGHT_BITS: u32 = 75;
/// The five rungs a quint decodes to, over 64.
const LADDER: [f32; 5] = [0.0, 0.25, 0.5, 0.75, 1.0];

/// One channel's fit: byte endpoints and the sixteen ranks on what decodes.
fn plane(texels: &Texels, channel: usize) -> (u8, u8, [u8; 16]) {
    let alone: Texels = texels.map(|t| [t[channel], 0.0, 0.0, 0.0]);
    let fitted = fit(&alone, &LADDER, segment(&alone));
    let e0 = fitted.0[0].round().clamp(0.0, 255.0) as u8;
    let e1 = fitted.1[0].round().clamp(0.0, 255.0) as u8;
    let rank = assign(
        &alone,
        &LADDER,
        [f32::from(e0), 0.0, 0.0, 0.0],
        [f32::from(e1), 0.0, 0.0, 0.0],
    );
    (e0, e1, rank)
}

/// Writes the block: X on the luminance plane, Y on the alpha plane.
pub fn encode(texels: &Texels) -> [u8; 16] {
    let (l0, l1, x) = plane(texels, 0);
    let (a0, a1, y) = plane(texels, 1);
    let mut bits = BLOCK_MODE | CEM << 13;
    let mut at = ENDPOINT_BIT;
    // Mode 4 reads v0..v3 as e0 = (v0, v0, v0, v2), e1 = (v1, v1, v1, v3).
    for value in [l0, l1, a0, a1] {
        bits |= u128::from(value) << at;
        at += 8;
    }
    bits |= PLANE_2_CHANNEL << (128 - WEIGHT_BITS - 2);
    // Weights interleave the two planes per texel and are read from the top of
    // the block downward, the first stream bit at bit 127.
    let weights: [u8; 32] = std::array::from_fn(|i| if i % 2 == 0 { x[i / 2] } else { y[i / 2] });
    let mut stream = 0u32;
    for group in weights.chunks(3) {
        let mut quints = [0u8; 3];
        quints[..group.len()].copy_from_slice(group);
        let packed = ise::packed_quints(quints);
        let width = [3, 5, 7][group.len() - 1];
        for bit in 0..width {
            if (packed >> bit) & 1 == 1 {
                bits |= 1u128 << (127 - (stream + bit));
            }
        }
        stream += width;
    }
    debug_assert_eq!(stream, WEIGHT_BITS);
    bits.to_le_bytes()
}
