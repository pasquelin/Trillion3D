//! The quality gate of a block-compressed chain: every level is read back
//! through the independent decoder and compared with the RGBA8 level it was
//! cut from, on the channels the materials read. A chain passes when its PSNR
//! over every level reaches `GATE_DB`, no texel moves by more than
//! `GATE_MAX_DELTA` on a read channel — a decibel is a mean, a texel is what a
//! pixel shows — and no texel of a masked texture changes side of an alpha
//! cutoff: a flipped texel is a leaf that appears or a hole that closes,
//! whatever the decibels say. A chain that fails stays lossless, and the report
//! names it with its figures.
use super::decode::decode_level;
use super::{BlockFormat, Layout};

/// Peak signal-to-noise ratio, in decibels over the whole chain, under which a
/// texture is not block-compressed: at 48 dB the root-mean-square error is one
/// level of 255.
pub const GATE_DB: f64 = 48.0;
/// Largest gap a read channel may show on one texel, in levels of 255: three,
/// the bar the maintainer set for a still capture — below what an 8-bit
/// display discriminates — carried to the texel, since filtering only averages
/// texels and a delta the texel does not have, the pixel cannot show. Measured
/// on the captures of the batch, not derived: the light multiplies an albedo.
pub const GATE_MAX_DELTA: u8 = 3;

/// Which channels of a texture its readers sample — the gate measures those.
pub type Channels = [bool; 4];

/// What a chain's read-back measured, level by level, added up.
#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct Measure {
    pub squared: f64,
    pub samples: u64,
    /// Largest channel gap on one texel, in levels of 255.
    pub max_delta: u8,
    /// Texels of a masked texture that changed side of a cutoff.
    pub flips: u64,
}

impl Measure {
    /// Decibels over the samples; infinite when every one came back exact.
    pub fn psnr_db(&self) -> f64 {
        if self.samples == 0 || self.squared == 0.0 {
            return f64::INFINITY;
        }
        10.0 * (255.0f64 * 255.0 * self.samples as f64 / self.squared).log10()
    }
    pub fn passes(&self) -> bool {
        self.flips == 0 && self.max_delta <= GATE_MAX_DELTA && self.psnr_db() >= GATE_DB
    }
    /// Adds one level: `decoded` against `source`, on `channels`; `cutoffs` are
    /// the alpha cutoffs of the masked materials that read the texture.
    pub fn add_level(
        &mut self,
        source: &[u8],
        decoded: &[u8],
        channels: Channels,
        cutoffs: &[f32],
    ) {
        debug_assert_eq!(source.len(), decoded.len());
        for (s, d) in source
            .as_chunks::<4>()
            .0
            .iter()
            .zip(decoded.as_chunks::<4>().0)
        {
            for channel in (0..4).filter(|&c| channels[c]) {
                let gap = s[channel].abs_diff(d[channel]);
                self.squared += f64::from(gap) * f64::from(gap);
                self.samples += 1;
                self.max_delta = self.max_delta.max(gap);
            }
            let side = |alpha: u8, cutoff: f32| f32::from(alpha) / 255.0 >= cutoff;
            if cutoffs.iter().any(|&c| side(s[3], c) != side(d[3], c)) {
                self.flips += 1;
            }
        }
    }
}

/// Encodes every level of a chain in one family and layout and measures the
/// read-back of each: the blocks, level by level, and the measure. `sizes`
/// gives each level's dimensions in chain order. A level the decoder refuses is
/// the named refusal of the whole image, never a panic.
pub fn encode_chain(
    levels: &[Vec<u8>],
    sizes: &[(u32, u32)],
    format: BlockFormat,
    layout: Layout,
    channels: Channels,
    cutoffs: &[f32],
) -> Result<(Vec<Vec<u8>>, Measure), &'static str> {
    let mut measure = Measure::default();
    let mut blocks = Vec::with_capacity(levels.len());
    for (pixels, &(w, h)) in levels.iter().zip(sizes) {
        let encoded = super::encode_level(pixels, w, h, format, layout);
        let decoded = decode_level(&encoded, w, h, format, layout)
            .map_err(|_| "texture-blocks-undecodable")?;
        measure.add_level(pixels, &decoded, channels, cutoffs);
        blocks.push(encoded);
    }
    Ok((blocks, measure))
}
