//! EAC block writer, one channel in eight bytes: a base byte, a multiplier, one
//! of sixteen modifier tables and, per texel, three bits naming the modifier.
//! It is the alpha of an ETC2 RGBA8 block, and each half of an EAC RG11 block —
//! X then Y of a normal map, each on a ladder of its own, as in BC5.
//!
//! Both read the same fields. The alpha block decodes `clamp(b + m · table[i])`;
//! an R11 channel decodes `clamp(8b + 4 + 8m · table[i])` over 2047, the same
//! value times eight plus four, which the card reads back to that very byte
//! (`decode.rs`). The multiplier is never written 0, where the two rules part.
//! The search is the specification's own space, narrowed: every table, the
//! multipliers around the one whose ladder spans the block's range, the bases
//! around the one that centres it; each texel takes its nearest modifier.
use super::fit::Texels;
use crate::eac_modifiers::EAC_MODIFIERS;

/// The table holding a zero modifier, at this index: a flat block is exact there.
const FLAT_TABLE: usize = 13;
const FLAT_INDEX: u8 = 4;

/// One candidate: squared error, base, multiplier, table, the index of every texel.
type Fit = (i32, i32, i32, usize, [u8; 16]);

/// Each texel's nearest modifier at base `b`, multiplier `m`, table `t`, and the error.
fn assigned(values: &[i32; 16], b: i32, m: i32, t: usize) -> Fit {
    let mut indices = [0u8; 16];
    let mut error = 0;
    for (index, &v) in values.iter().enumerate() {
        let (mut best, mut gap) = (0u8, i32::MAX);
        for (i, modifier) in EAC_MODIFIERS[t].iter().enumerate() {
            let d = v - (b + m * modifier).clamp(0, 255);
            if d * d < gap {
                (best, gap) = (i as u8, d * d);
            }
        }
        indices[index] = best;
        error += gap;
    }
    (error, b, m, t, indices)
}

/// The block of `channel`. Texels come in reading order; the block numbers them
/// column by column, the first texel's three bits at the top of the 48.
pub fn encode(texels: &Texels, channel: usize) -> [u8; 8] {
    let values: [i32; 16] = texels.map(|t| t[channel].round() as i32);
    let (lo, hi) = (
        *values.iter().min().expect("sixteen"),
        *values.iter().max().expect("sixteen"),
    );
    let mut best: Fit = (0, lo, 1, FLAT_TABLE, [FLAT_INDEX; 16]);
    if lo != hi {
        best.0 = i32::MAX;
        'search: for (t, table) in EAC_MODIFIERS.iter().enumerate() {
            let (low, high) = (table[3], table[7]);
            let span = (hi - lo) as f32 / (high - low) as f32;
            let m0 = span.round() as i32;
            for m in (m0 - 1).clamp(1, 15)..=(m0 + 1).clamp(1, 15) {
                let centre = ((lo + hi - m * (low + high)) as f32 / 2.0).round() as i32;
                for b in (centre - 1).clamp(0, 255)..=(centre + 1).clamp(0, 255) {
                    let fit = assigned(&values, b, m, t);
                    if fit.0 < best.0 {
                        best = fit;
                        if best.0 == 0 {
                            break 'search;
                        }
                    }
                }
            }
        }
    }
    let (_, base, multiplier, table, indices) = best;
    let mut word = (base as u64) << 56 | (multiplier as u64) << 52 | (table as u64) << 48;
    for (reading, &index) in indices.iter().enumerate() {
        let column_major = (reading % 4) * 4 + reading / 4;
        word |= u64::from(index) << (45 - 3 * column_major);
    }
    word.to_be_bytes()
}
