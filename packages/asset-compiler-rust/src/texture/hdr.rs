//! The half-float atlas: the mip chain of a texture whose file stores floating point (OpenEXR,
//! Radiance HDR), kept in floating point end to end.
//!
//! The image is never cut down to eight bits: that would need a tone curve, a loss the source
//! did not have. Its levels are the mean of the four texels of every channel, in linear `f32`,
//! each from the level above in `f32` — no byte quantises a level before the next —, and each is
//! stored as `rgba16float`, the one float format a WebGPU device samples with filtering whatever
//! its features (`rgba32float` needs the optional `float32-filterable`). A value past the
//! half-float range holds at its largest finite value, never infinity; a NaN reads as zero.
//! Nothing here is block-compressed: the format has no lossy codec this chain would pass the
//! gate's bars in — BC6H keeps no alpha and no sign —, so what the sidecar and the level files
//! carry is the half-float texels themselves.
use half::f16;
use rayon::prelude::*;
use std::borrow::Cow;
use trillion3d_math::scalar::unit_to_byte_f32;

/// Bytes of one half-float texel: four 16-bit channels.
pub(crate) const HALF_TEXEL_BYTES: usize = 8;
/// The file format of a half-float level: the `{format}` of the level template.
pub(crate) const HALF_FILE: &str = "rgba16f";
/// What a chain holds beyond the image's decoded `f32` texels, per texel, at most: every level's
/// half-floats (eight bytes and a third) and the `f32` level being reduced.
pub(crate) const CHAIN_BYTES_PER_PIXEL: usize = 12;
/// Largest finite half-float.
const HALF_MAX: f32 = 65504.0;

/// A channel as its half-float bits.
fn half_bits(value: f32) -> u16 {
    if value.is_nan() {
        return 0;
    }
    f16::from_f32(value.clamp(-HALF_MAX, HALF_MAX)).to_bits()
}

/// A level's texels as the bytes of the atlas: each channel's half-float, little-endian. Each chunk
/// of texels writes its own span of one buffer: no chunk builds a vector of its own to be joined.
pub(crate) fn pack(level: &[f32]) -> Vec<u8> {
    let mut bytes = vec![0u8; level.len() * 2];
    bytes
        .par_chunks_mut(2 * 4096)
        .zip(level.par_chunks(4096))
        .for_each(|(out, texels)| {
            for (pair, &value) in out.chunks_exact_mut(2).zip(texels) {
                pair.copy_from_slice(&half_bits(value).to_le_bytes());
            }
        });
    bytes
}

/// The next level of a level `size` texels wide and high, `next` its own size: the mean of the
/// four texels of every channel — `value(i)` the `i`-th value of the level above, texel after texel,
/// four channels each —, an odd side repeating its last texel. Rows are computed in parallel, each
/// texel from its own four alone. The one reduction in float of the half-float atlas and of a
/// chain reduced from 16 bits (`reduce::chain_wide`).
pub(super) fn halve(
    value: impl Fn(usize) -> f32 + Sync,
    (width, height): (usize, usize),
    (columns, rows): (usize, usize),
) -> Vec<f32> {
    let mut out = vec![0f32; columns * rows * 4];
    out.par_chunks_mut(columns * 4)
        .enumerate()
        .for_each(|(row, line)| {
            let y = [(row * 2).min(height - 1), (row * 2 + 1).min(height - 1)];
            for (column, texel) in line.as_chunks_mut::<4>().0.iter_mut().enumerate() {
                let x = [(column * 2).min(width - 1), (column * 2 + 1).min(width - 1)];
                for (channel, out) in texel.iter_mut().enumerate() {
                    let at = |x: usize, y: usize| value((y * width + x) * 4 + channel);
                    *out =
                        (at(x[0], y[0]) + at(x[1], y[0]) + at(x[0], y[1]) + at(x[1], y[1])) * 0.25;
                }
            }
        });
    out
}

/// A level's texels as 32-bit floats, four channels, little-endian: a NaN reads as zero, an infinity
/// holds at the largest finite value (`hdrF32`).
pub(crate) fn pack_f32(level: &[f32]) -> Vec<u8> {
    level
        .iter()
        .flat_map(|&value| {
            let value = if value.is_nan() {
                0.0
            } else {
                value.clamp(f32::MIN, f32::MAX)
            };
            value.to_le_bytes()
        })
        .collect()
}

/// The red channel of a level's texels as 32-bit floats, little-endian (`singleFloat`).
pub(crate) fn pack_red_f32(level: &[f32]) -> Vec<u8> {
    pack_f32(&level.iter().step_by(4).copied().collect::<Vec<_>>())
}

/// The red channel of a level's texels as half-floats, little-endian (`halfFloat`).
pub(crate) fn pack_red_half(level: &[f32]) -> Vec<u8> {
    pack(&level.iter().step_by(4).copied().collect::<Vec<_>>())
}

/// The red channel of a level's texels as the eight-bit texels RGBA8 holds, the value held between
/// zero and one and shown grey: what a chain of a float setting keeps in the sidecar beside its
/// exact tail, for a reader that has no use of the floats.
pub(crate) fn proxy_rgba8(level: &[f32]) -> Vec<u8> {
    level
        .iter()
        .step_by(4)
        .flat_map(|&value| {
            let byte = unit_to_byte_f32(value);
            [byte, byte, byte, 255]
        })
        .collect()
}

/// The entire chain of `source`, `width` × `height` linear RGBA texels, level 0 included:
/// `levels[k]` is level `k` as the atlas stores it, at `preview_level_size` dimensions.
pub(crate) fn chain(width: u32, height: u32, source: &[f32]) -> Vec<Vec<u8>> {
    chain_with(width, height, source, pack)
}

/// The same chain with each level's texels stored by `store`: the reduction is in `f32` all the way.
pub(crate) fn chain_with(
    width: u32,
    height: u32,
    source: &[f32],
    store: impl Fn(&[f32]) -> Vec<u8>,
) -> Vec<Vec<u8>> {
    let last = super::preview_last_level(width, height);
    let mut levels = Vec::with_capacity(last as usize + 1);
    levels.push(store(source));
    let mut current = Cow::Borrowed(source);
    for level in 1..=last {
        let size = super::preview_level_size(width, height, level - 1);
        let next = super::preview_level_size(width, height, level);
        let reduced = halve(
            |i| current[i],
            (size.0 as usize, size.1 as usize),
            (next.0 as usize, next.1 as usize),
        );
        levels.push(store(&reduced));
        current = Cow::Owned(reduced);
    }
    levels
}
