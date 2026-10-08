//! ETC2 RGBA8 block writer: eight bytes of EAC alpha (`eac.rs`), then eight of
//! ETC2 colour. The colour half tries three of the codec's modes and keeps the
//! one whose read-back errs least: two half-blocks — side by side or stacked —
//! each a base colour on 4 bits (individual) or on 5 bits with the second a
//! small step from the first (differential), plus one of eight luminance
//! tables whose four modifiers every texel picks from; or a plane through
//! three colours (planar), for the gradients the half-blocks band. The T and
//! H modes are not searched: a block they would win is one the gate measures.
//!
//! Bits follow the specification's big-endian numbering. Texels come in
//! reading order; the block numbers them column by column, the index of texel
//! `p` split into its high bit (bit `p` of bytes 4–5) and its low one (bytes 6–7).
use super::eac;
use super::etc2_planar::planar;
use super::fit::Texels;
use trillion3d_math::scalar::mean_f32;
use trillion3d_math::vecn::distance2_i32;

/// The eight luminance tables, small then large modifier.
const MODIFIERS: [[i32; 2]; 8] = [
    [2, 8],
    [5, 17],
    [9, 29],
    [13, 42],
    [18, 60],
    [24, 80],
    [33, 106],
    [47, 183],
];

pub(super) type Rgb = [i32; 3];

/// The texels of half `half`, reading-order indices: columns 0–1 or 2–3 side
/// by side, rows 0–1 or 2–3 when `flip` stacks them.
fn members(flip: bool, half: usize) -> [usize; 8] {
    std::array::from_fn(|k| {
        let (a, b) = (half * 2 + k % 2, k / 2);
        if flip {
            a * 4 + b
        } else {
            b * 4 + a
        }
    })
}

/// A texel's colour, the bytes the fit carries as floats.
pub(super) fn rgb(texel: &[f32; 4]) -> Rgb {
    [0, 1, 2].map(|c| texel[c].round() as i32)
}

/// Squared distance of two colours.
pub(super) fn gap(a: Rgb, b: Rgb) -> i32 {
    distance2_i32(a, b)
}

/// A half at base `colour`: the table whose modifiers err least, its error, and
/// each member's two-bit index (high bit the sign, low bit the large modifier).
fn half(texels: &Texels, members: &[usize; 8], colour: Rgb) -> (i32, u32, [u8; 8]) {
    let mut best = (i32::MAX, 0u32, [0u8; 8]);
    for (table, [small, large]) in MODIFIERS.iter().enumerate() {
        let (mut error, mut picks) = (0, [0u8; 8]);
        for (k, &member) in members.iter().enumerate() {
            let target = rgb(&texels[member]);
            let (index, cost) = [*small, *large, -small, -large]
                .iter()
                .map(|m| gap(target, colour.map(|c| (c + m).clamp(0, 255))))
                .enumerate()
                .min_by_key(|&(_, cost)| cost)
                .expect("four modifiers");
            picks[k] = index as u8;
            error += cost;
        }
        if error < best.0 {
            best = (error, table as u32, picks);
        }
    }
    best
}

fn mean(texels: &Texels, members: &[usize; 8]) -> [f32; 3] {
    std::array::from_fn(|c| mean_f32(members.iter().map(|&m| texels[m][c])))
}

/// The best block in the two half-block modes, both arrangements: error, bytes.
fn halves(texels: &Texels) -> (i32, [u8; 8]) {
    let mut best = (i32::MAX, [0u8; 8]);
    for flip in [false, true] {
        let parts = [members(flip, 0), members(flip, 1)];
        let means = parts.map(|m| mean(texels, &m));
        let four = means.map(|m| m.map(|v| (v * 15.0 / 255.0).round() as i32));
        let first = means[0].map(|v| (v * 31.0 / 255.0).round() as i32);
        let second: Rgb = std::array::from_fn(|c| {
            first[c] + ((means[1][c] * 31.0 / 255.0).round() as i32 - first[c]).clamp(-4, 3)
        });
        let five = |q: Rgb| q.map(|v| v << 3 | v >> 2);
        for differential in [false, true] {
            let bases = if differential {
                [five(first), five(second)]
            } else {
                four.map(|q| q.map(|v| v * 17))
            };
            let fits = [0, 1].map(|h| half(texels, &parts[h], bases[h]));
            let error = fits[0].0 + fits[1].0;
            if error >= best.0 {
                continue;
            }
            let mut bytes = [0u8; 8];
            for (c, byte) in bytes.iter_mut().take(3).enumerate() {
                *byte = if differential {
                    (first[c] << 3 | (second[c] - first[c]) & 7) as u8
                } else {
                    (four[0][c] << 4 | four[1][c]) as u8
                };
            }
            bytes[3] = (fits[0].1 << 5 | fits[1].1 << 2 | u32::from(differential) << 1) as u8
                | u8::from(flip);
            let (mut high, mut low) = (0u16, 0u16);
            for (h, fit) in fits.iter().enumerate() {
                for (k, &index) in fit.2.iter().enumerate() {
                    let reading = parts[h][k];
                    let p = (reading % 4) * 4 + reading / 4;
                    high |= u16::from(index >> 1) << p;
                    low |= u16::from(index & 1) << p;
                }
            }
            bytes[4..6].copy_from_slice(&high.to_be_bytes());
            bytes[6..8].copy_from_slice(&low.to_be_bytes());
            best = (error, bytes);
        }
    }
    best
}

/// Writes the block: alpha, then colour in the mode that errs least.
pub fn encode(texels: &Texels) -> [u8; 16] {
    let mut block = [0u8; 16];
    block[..8].copy_from_slice(&eac::encode(texels, 3));
    let (two, plane) = (halves(texels), planar(texels));
    let colour = if plane.0 < two.0 { plane.1 } else { two.1 };
    block[8..].copy_from_slice(&colour);
    block
}
