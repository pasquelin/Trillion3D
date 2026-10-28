use super::curves::{linear_to_srgb, srgb_table};
use super::*;
use rayon::prelude::*;
use std::borrow::Cow;
use std::sync::OnceLock;
use trillion3d_math::color::srgb_to_linear_f32;
use trillion3d_math::scalar::{byte_to_unit_f32, mean_f32, unit_to_byte_f32};

/// What the atlas layer does with the bytes, and therefore what reduction must do
/// with the same: the colour atlas is `rgba8unorm-srgb`, its first three channels
/// go through the sRGB curve; the data atlas is `rgba8unorm`, everything there is
/// linear. Alpha goes through no curve in either case — that is how WebGPU defines
/// these formats. The half-float atlas holds the colour textures a file stores in floating
/// point (`rgba16float`, every channel linear): it has its own chain (`hdr.rs`), which this
/// module's does not read.
///
/// Entries sort by the atlas that samples the chain, so one texture carries a colour
/// entry and a data entry at most, or its half-float entry alone.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum AtlasKind {
    Color,
    Data,
    Hdr,
}
impl AtlasKind {
    /// The sidecar's atlas word: 0, 1 or 2.
    pub fn word(self) -> u32 {
        match self {
            Self::Color => 0,
            Self::Data => 1,
            Self::Hdr => 2,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Color => "srgb",
            Self::Data => "linear",
            Self::Hdr => "hdr",
        }
    }
    /// The atlas a sidecar word names; `None` for a word this version never wrote.
    pub fn from_word(word: u32) -> Option<Self> {
        match word {
            0 => Some(Self::Color),
            1 => Some(Self::Data),
            2 => Some(Self::Hdr),
            _ => None,
        }
    }
    /// Bytes of one texel of the atlas's chain as the previews' pixel file holds it: four
    /// 8-bit channels, or four half-floats.
    pub fn texel_bytes(self) -> usize {
        match self {
            Self::Color | Self::Data => 4,
            Self::Hdr => super::hdr::HALF_TEXEL_BYTES,
        }
    }
}

/// The ENTIRE mip chain of a source, level 0 included: `levels[k]` is level `k` in
/// RGBA8, at `preview_level_size` dimensions, level 0 the source's own texels, borrowed.
///
/// Each level is computed from the PREVIOUS level already quantised to bytes, never
/// from a kept float, so that baking levels instead of regenerating them does not
/// change the image: all four channels are the plain mean of the four texels —
/// colours decoded by the atlas curve and re-encoded, alpha as it is, no texel weighing
/// another and no coverage kept —; an odd side repeats its last texel. No curve declared
/// by the file: the atlas does not know it, and the pyramid follows display, not the file.
///
/// The levels the file stores below level 0 (`stored`, levels 1 on, a DDS's) are kept as they are,
/// and only the levels past them are reduced, from the last stored one.
pub(crate) fn chain<'a, C: std::ops::Deref<Target = [u8]>>(
    source: &'a image::ImageBuffer<image::Rgba<u8>, C>,
    stored: &'a [Vec<u8>],
    kind: AtlasKind,
) -> Vec<Cow<'a, [u8]>> {
    debug_assert!(
        kind != AtlasKind::Hdr,
        "a half-float chain is `hdr::chain`'s"
    );
    let (width, height) = source.dimensions();
    let last = preview_last_level(width, height);
    let mut levels = Vec::with_capacity(last as usize + 1);
    levels.push(Cow::Borrowed(&**source.as_raw()));
    levels.extend(
        stored
            .iter()
            .take(last as usize)
            .map(|level| Cow::Borrowed(&level[..])),
    );
    for level in levels.len() as u32..=last {
        let size = preview_level_size(width, height, level - 1);
        let next = preview_level_size(width, height, level);
        let previous = levels.last().expect("previous level");
        levels.push(Cow::Owned(halve(previous, size, next, kind)));
    }
    levels
}

/// The chain of a source stored at 16 bits a channel, level 0 included: `wide` its RGBA samples,
/// `source` the bytes they round to (`ImageDecoded::wide`). Level 0 is `source`, borrowed; every
/// level past it is reduced in `f32` — the colours decoded by the atlas curve from the 16-bit
/// sample, never from a level's bytes — and rounded to bytes once, when it is written: the
/// accumulated rounding of eight bits a level is gone, the precision the file holds reaches the
/// last level.
pub(crate) fn chain_wide<'a, C: std::ops::Deref<Target = [u8]>>(
    source: &'a image::ImageBuffer<image::Rgba<u8>, C>,
    wide: &[u16],
    kind: AtlasKind,
) -> Vec<Cow<'a, [u8]>> {
    debug_assert!(
        kind != AtlasKind::Hdr,
        "a half-float chain is `hdr::chain`'s"
    );
    let (width, height) = source.dimensions();
    let last = preview_last_level(width, height);
    let table = wide_table(kind);
    let sample = |i: usize| table[i % 4 / 3][wide[i] as usize];
    let mut levels = vec![Cow::Borrowed(&**source.as_raw())];
    let mut current: Option<Vec<f32>> = None;
    for level in 1..=last {
        let size = preview_level_size(width, height, level - 1);
        let next = preview_level_size(width, height, level);
        let (size, next) = (
            (size.0 as usize, size.1 as usize),
            (next.0 as usize, next.1 as usize),
        );
        let reduced = match &current {
            None => super::hdr::halve(sample, size, next),
            Some(above) => super::hdr::halve(|i| above[i], size, next),
        };
        levels.push(Cow::Owned(encode_level(&reduced, kind)));
        current = Some(reduced);
    }
    levels
}

/// The linear value of each 16-bit sample, one table for the colours — by the atlas's curve — and
/// one for alpha, which goes through none: `[colour, alpha]`.
fn wide_table(kind: AtlasKind) -> [&'static [f32]; 2] {
    static SRGB: OnceLock<Vec<f32>> = OnceLock::new();
    static LINEAR: OnceLock<Vec<f32>> = OnceLock::new();
    let unit = |of: fn(f32) -> f32| (0..=u16::MAX).map(|v| of(f32::from(v) / 65535.0)).collect();
    let linear = LINEAR.get_or_init(|| unit(|v| v));
    match kind {
        AtlasKind::Color => [SRGB.get_or_init(|| unit(srgb_to_linear_f32)), linear],
        _ => [linear, linear],
    }
}

/// A reduced level's linear texels as the bytes the atlas stores: the colours encoded by its
/// curve, alpha as it is, each rounded to nearest. Each chunk writes its own span of one buffer.
fn encode_level(level: &[f32], kind: AtlasKind) -> Vec<u8> {
    let mut bytes = vec![0u8; level.len()];
    bytes
        .par_chunks_mut(4096)
        .zip(level.par_chunks(4096))
        .for_each(|(out, texels)| {
            for (texel, bytes) in texels.chunks_exact(4).zip(out.chunks_exact_mut(4)) {
                for (channel, byte) in bytes.iter_mut().enumerate() {
                    *byte = match channel {
                        3 => unit_to_byte_f32(texel[3]),
                        _ => encode(texel[channel], kind),
                    };
                }
            }
        });
    bytes
}

/// Tail the sidecar carries: levels from `preview_first_level` on, end to end.
pub(super) fn tail(levels: &[Cow<'_, [u8]>], first: u32) -> Vec<u8> {
    levels[first as usize..].concat()
}

/// Table that brings a byte of the previous level back to the value the GPU
/// averages: the sRGB curve for colours of a colour atlas, division by 255 everywhere else.
fn decode_table(kind: AtlasKind) -> &'static [f32; 256] {
    match kind {
        AtlasKind::Color => srgb_table(),
        AtlasKind::Data | AtlasKind::Hdr => super::curves::linear_table(),
    }
}

fn encode(value: f32, kind: AtlasKind) -> u8 {
    match kind {
        AtlasKind::Color => linear_to_srgb(value),
        AtlasKind::Data | AtlasKind::Hdr => unit_to_byte_f32(value),
    }
}

/// Next level from the previous bytes: the mean of the four texels of each channel, the three
/// colours in the atlas's linear space. Rows are computed in parallel, each texel from its own
/// four alone.
fn halve(previous: &[u8], size: (u32, u32), next: (u32, u32), kind: AtlasKind) -> Vec<u8> {
    let table = decode_table(kind);
    let (width, height) = (size.0 as usize, size.1 as usize);
    let (columns, rows) = (next.0 as usize, next.1 as usize);
    let mut out = vec![0u8; columns * rows * 4];
    out.par_chunks_mut(columns * 4)
        .enumerate()
        .for_each(|(row, line)| {
            let y0 = (row * 2).min(height - 1);
            let y1 = (row * 2 + 1).min(height - 1);
            for (column, texel) in line.as_chunks_mut::<4>().0.iter_mut().enumerate() {
                let x0 = (column * 2).min(width - 1);
                let x1 = (column * 2 + 1).min(width - 1);
                let at = |x: usize, y: usize| (y * width + x) * 4;
                let texels = [at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)];
                let alpha = texels.map(|t| byte_to_unit_f32(previous[t + 3]));
                let colours: [[f32; 3]; 4] = texels
                    .map(|t| std::array::from_fn(|channel| table[previous[t + channel] as usize]));
                let [r, g, b] = std::array::from_fn(|channel| {
                    encode(mean_f32(colours.map(|colour| colour[channel])), kind)
                });
                texel.copy_from_slice(&[r, g, b, unit_to_byte_f32(mean_f32(alpha))]);
            }
        });
    out
}
