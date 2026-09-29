//! What a `WGP3` page carries for the GPU deformation stage (#357): the joints and weights of a
//! skinned vertex, and the position and normal displacement of each morph target. Both are
//! optional streams after the colour, flagged in word 4; word 23 of the header packs the skin
//! record and the target count (`word`), and each target's record follows the twenty-four header
//! words — nine words each, the first the word its streams start at, which a reader recomputes
//! and trusts only when it matches, so every offset still follows from the counts and the widths.

use crate::bits::{dequant, le_words, stream_words, BitReader, Quant};
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
/// Joints and weights per skinned vertex.
pub const INFLUENCES: usize = 4;
/// Bits of a stored weight: three are stored, the fourth is what their sum leaves of 255.
pub const WEIGHT_BITS: u32 = 8;
pub const WEIGHT_SCALE: u32 = 255;

/// The skin record: the page's smallest joint and the width of each joint's distance to it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Skin {
    pub base: u32,
    pub bits: u32,
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
        let f = f32::from_bits;
        Some(Self {
            start: w[0] as usize,
            position: Quant::unpack(w[1], [f(w[2]), f(w[3]), f(w[4])])?,
            normal: Quant::unpack(w[5], [f(w[6]), f(w[7]), f(w[8])])?,
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
        bits: packed & 63,
        base: (packed >> 14) & 0xffff,
    };
    let count = ((packed >> 6) & 255) as usize;
    let sane = word(&skin, count) == packed
        && (skinned || skin == Skin::default())
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

/// Words the skin's seven streams take: four joints, three weights.
pub fn skin_words(skin: &Skin, vertices: usize) -> usize {
    INFLUENCES * stream_words(vertices, skin.bits) + 3 * stream_words(vertices, WEIGHT_BITS)
}

/// Words one target's six streams take.
pub fn morph_words(morph: &Morph, vertices: usize) -> usize {
    morph
        .bits()
        .iter()
        .map(|&b| stream_words(vertices, b))
        .sum()
}

/// The fourth weight: what the three stored leave of 255, never below zero.
pub fn last_weight(stored: [u32; 3]) -> u32 {
    WEIGHT_SCALE.saturating_sub(stored.iter().sum::<u32>().min(WEIGHT_SCALE))
}

/// Decodes the skin into `out`: the four joints of every vertex, then its four weights, from its
/// streams at word `start` of `words`.
pub fn decode_skin(words: &[u32], start: usize, skin: &Skin, out: &mut [u32]) {
    let n = out.len() / (2 * INFLUENCES);
    let (joints, weights) = out.split_at_mut(n * INFLUENCES);
    let (joint_words, weight_words) = (stream_words(n, skin.bits), stream_words(n, WEIGHT_BITS));
    let at = |word: usize| BitReader::at(words, word * 32);
    let mut joint: [BitReader; INFLUENCES] = core::array::from_fn(|j| at(start + j * joint_words));
    let first_weight = start + INFLUENCES * joint_words;
    let mut weight: [BitReader; 3] = core::array::from_fn(|j| at(first_weight + j * weight_words));
    let rows = joints.as_chunks_mut::<INFLUENCES>().0.iter_mut();
    for (vertex, share) in rows.zip(weights.as_chunks_mut::<INFLUENCES>().0) {
        for (j, reader) in joint.iter_mut().enumerate() {
            vertex[j] = ((skin.base + reader.read(skin.bits)) as f32).to_bits();
        }
        let stored: [u32; 3] = core::array::from_fn(|j| weight[j].read(WEIGHT_BITS));
        for (j, &w) in stored.iter().chain(&[last_weight(stored)]).enumerate() {
            share[j] = (w as f32 / WEIGHT_SCALE as f32).to_bits();
        }
    }
}

/// Decodes every target into `out`, `6 × targets` floats per vertex: each target's position
/// displacement, then its normal displacement, target after target.
pub fn decode_morphs(words: &[u32], morphs: &[Morph], out: &mut [u32]) {
    let width = 6 * morphs.len();
    let n = out.len() / width.max(1);
    for (t, morph) in morphs.iter().enumerate() {
        let mut at = morph.start;
        for (c, bits) in morph.bits().into_iter().enumerate() {
            let record = if c < 3 {
                &morph.position
            } else {
                &morph.normal
            };
            let (min, step) = (record.min[c % 3], record.step());
            let mut stream = BitReader::at(words, at * 32);
            for vertex in 0..n {
                out[vertex * width + t * 6 + c] = dequant(min, stream.read(bits), step).to_bits();
            }
            at += stream_words(n, bits);
        }
    }
}

#[cfg(test)]
#[path = "deform_tests.rs"]
mod tests;
