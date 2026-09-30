//! What a `WGP3` page carries for the GPU deformation stage (#357): the joints and weights of a
//! skinned vertex, and the position and normal displacement of each morph target. Both are
//! optional streams after the colour, flagged in word 4; word 23 of the header packs the skin
//! record and the target count (`word`), and each target's record follows the twenty-five header
//! words — nine words each, the first the word its streams start at, which a reader recomputes
//! and trusts only when it matches, so every offset still follows from the counts and the widths.

use crate::bits::{le_words, stream_words, BitReader, Quant};
use crate::HEADER_BYTES;

/// Presence bits of the skin and of the morph targets, beside those of `lib.rs`.
pub const FLAG_SKIN: u32 = 16;
pub const FLAG_MORPH: u32 = 32;
/// Widest joint field: a skin names at most 65,536 joints.
pub const MAX_JOINT_BITS: u32 = 16;
/// Most morph targets a page carries: eight bits of word 23.
pub const MAX_MORPH_TARGETS: usize = 255;
/// Header words of one morph target: its first stream, then its position and normal records.
pub const MORPH_WORDS: usize = 9;
/// Bits of every source weight, stored without quantization.
pub const WEIGHT_BITS: u32 = 32;
/// The one record a morph displacement takes: exact float32 bits, no grid.
pub const RAW_F32: Quant<3> = Quant {
    min: [0.0; 3],
    exponent: 0,
    bits: [32; 3],
};

/// The skin record: the page's smallest joint and the width of each joint's distance to it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Skin {
    pub base: u32,
    pub bits: u32,
    pub influences: usize,
}

/// Word 23: the joint width in bits 0 to 5, the target count in bits 6 to 13, the smallest joint
/// in bits 14 to 29, two bits zero.
pub fn word(skin: &Skin, targets: usize) -> u32 {
    skin.bits | (targets as u32) << 6 | skin.base << 14
}

/// One morph target of a page: the word its six streams start at, after the header, and the
/// records of its position displacement and of its normal displacement.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Morph {
    pub start: usize,
    pub position: Quant<3>,
    pub normal: Quant<3>,
}

impl Morph {
    pub fn words(&self) -> [u32; MORPH_WORDS] {
        let [a, b, c] = self.position.min.map(f32::to_bits);
        let [d, e, f] = self.normal.min.map(f32::to_bits);
        let (p, n) = (self.position.packed(), self.normal.packed());
        [self.start as u32, p, a, b, c, n, d, e, f]
    }

    pub fn unpack(w: &[u32]) -> Option<Self> {
        if w[1] != RAW_F32.packed()
            || w[5] != RAW_F32.packed()
            || [w[2], w[3], w[4], w[6], w[7], w[8]] != [0; 6]
        {
            return None;
        }
        Some(Self {
            start: w[0] as usize,
            position: RAW_F32,
            normal: RAW_F32,
        })
    }

    /// Widths of its six streams, position then normal.
    pub fn bits(&self) -> [u32; 6] {
        let ([a, b, c], [d, e, f]) = (self.position.bits, self.normal.bits);
        [a, b, c, d, e, f]
    }
}

/// The skin record and the morph targets' records of a page whose flags word is `flags`, read
/// from word 23 and the records after the header; `None` when a field is set that the flags do
/// not announce, a record leaves the format, or the records pass the end of `data`.
pub fn parse(flags: u32, packed: u32, data: &[u8]) -> Option<(Skin, Vec<Morph>)> {
    let (skinned, morphed) = (flags & FLAG_SKIN != 0, flags & FLAG_MORPH != 0);
    let skin = Skin {
        influences: u32::from_le_bytes(data.get(96..100)?.try_into().ok()?) as usize,
        bits: packed & 63,
        base: (packed >> 14) & 0xffff,
    };
    let count = ((packed >> 6) & 255) as usize;
    let sane = word(&skin, count) == packed
        && (skinned || skin == Skin::default())
        && (!skinned || (skin.influences > 0 && skin.influences <= 65536))
        && skin.bits <= MAX_JOINT_BITS
        && u64::from(skin.base) + (1u64 << skin.bits) - 1 <= 0xffff
        && morphed == (count > 0);
    if !sane {
        return None;
    }
    let end = HEADER_BYTES + count * MORPH_WORDS * 4;
    let words: Vec<u32> = le_words(data.get(HEADER_BYTES..end)?).collect();
    let morphs = words.chunks(MORPH_WORDS).map(Morph::unpack);
    Some((skin, morphs.collect::<Option<Vec<_>>>()?))
}

/// Words occupied by all joint and float32 weight streams.
pub fn skin_words(skin: &Skin, vertices: usize) -> usize {
    skin.influences
        .saturating_mul(stream_words(vertices, skin.bits).saturating_add(vertices))
}

/// Words one target's six streams take.
pub fn morph_words(morph: &Morph, vertices: usize) -> usize {
    morph
        .bits()
        .iter()
        .map(|&b| stream_words(vertices, b))
        .sum()
}

/// Decodes the skin into `out`: all joints of every vertex, then all weights, from its
/// streams at word `start` of `words`.
pub fn decode_skin(words: &[u32], start: usize, skin: &Skin, out: &mut [u32]) {
    let width = skin.influences;
    let n = out.len() / (2 * width);
    let (joints, weights) = out.split_at_mut(n * width);
    let joint_words = stream_words(n, skin.bits);
    let first_weight = start + width * joint_words;
    for j in 0..width {
        let mut reader = BitReader::at(words, (start + j * joint_words) * 32);
        for v in 0..n {
            joints[v * width + j] = ((skin.base + reader.read(skin.bits)) as f32).to_bits();
            weights[v * width + j] = words[first_weight + j * n + v];
        }
    }
}

/// Decodes every target into `out`, `6 × targets` floats per vertex: each target's position
/// displacement, then its normal displacement, target after target.
pub fn decode_morphs(words: &[u32], morphs: &[Morph], out: &mut [u32]) {
    let width = 6 * morphs.len();
    let n = out.len() / width.max(1);
    for (t, morph) in morphs.iter().enumerate() {
        for c in 0..6 {
            for v in 0..n {
                out[v * width + t * 6 + c] = words[morph.start + c * n + v];
            }
        }
    }
}

#[cfg(test)]
#[path = "deform_tests.rs"]
mod tests;

/// The raw deformation streams must remain finite before any GPU reads the admitted page.
pub fn finite(data: &[u8], h: &crate::Header, layout: &crate::Layout) -> bool {
    let n = h.vertex_count;
    if h.flags & FLAG_SKIN != 0 {
        let start = layout.skin + h.skin.influences * stream_words(n, h.skin.bits);
        if !le_words(&data[start * 4..(start + h.skin.influences * n) * 4]).all(|w| {
            let f = f32::from_bits(w);
            f.is_finite() && f >= 0.0
        }) {
            return false;
        }
    }
    h.morphs.iter().all(|m| {
        le_words(&data[m.start * 4..(m.start + 6 * n) * 4]).all(|w| f32::from_bits(w).is_finite())
    })
}
