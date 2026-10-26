//! The quality gate of a block-compressed chain: every level is read back
//! through the independent decoder and compared with the RGBA8 level it was
//! cut from, on the channels the materials read. A chain passes when its PSNR
//! over every level reaches `GATE_DB`, no texel moves by more than
//! `GATE_MAX_DELTA` on a read channel — a decibel is a mean, a texel is what a
//! pixel shows — and no texel of a masked texture changes side of an alpha
//! cutoff: a flipped texel is a leaf that appears or a hole that closes,
//! whatever the decibels say. A chain that fails is left out of its family — the
//! device decodes the stored BC chain instead, which is kept whatever it measures
//! —, and the report names it with its figures.
//! The blocks alike their neighbours live in `alike`.
use super::super::cut::{keeps, Cut};
use super::decode::decode_block;
use super::{BlockFormat, Effort, Layout, BLOCK_BYTES};
use rayon::prelude::*;
mod alike;
use alike::{encode_alike, inside_rows, inside_tally, sided, texel_bytes};

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
    /// Whether the read-back holds the gate's bars: a chain is kept in its family only then, but
    /// in the stored one, kept whatever it measures.
    pub fn passes(&self) -> bool {
        self.flips == 0 && self.max_delta <= GATE_MAX_DELTA && self.psnr_db() >= GATE_DB
    }
    /// Adds one level: `decoded` against `source`, on `channels`; `cutoffs` are
    /// the cuts of the masked materials that read the texture, each keeping a
    /// texel at its alpha times its colour factor's, as the engine does (`keeps`). Runs of texels
    /// are measured in parallel and added up in integers (`Tally`), so the measure is the serial
    /// one, bit for bit.
    pub fn add_level(
        &mut self,
        source: &[u8],
        decoded: &[u8],
        channels: Channels,
        cutoffs: &[Cut],
    ) {
        /// Texels of one parallel run.
        const RUN: usize = 4096;
        debug_assert_eq!(source.len(), decoded.len());
        let level = source
            .par_chunks(RUN * 4)
            .zip(decoded.par_chunks(RUN * 4))
            .map(|(source, decoded)| Tally::of(source, decoded, channels, cutoffs))
            .reduce(Tally::default, Tally::merge)
            .measure();
        self.squared += level.squared;
        self.samples += level.samples;
        self.max_delta = self.max_delta.max(level.max_delta);
        self.flips += level.flips;
    }
}

/// What texels `decoded` show against `source`, in integers: the squared gaps on the read
/// channels, their count, the largest one and the texels that changed side of a cutoff. A squared
/// gap is an integer, and so is every sum of them below 2⁵³: tallies merged in any order add up
/// to the serial one.
#[derive(Clone, Copy, Default)]
struct Tally {
    squared: u64,
    samples: u64,
    max_delta: u8,
    flips: u64,
}

impl Tally {
    /// The tally of `decoded` against `source`, RGBA8 texels, on `channels` and across `cutoffs`.
    fn of(source: &[u8], decoded: &[u8], channels: Channels, cutoffs: &[Cut]) -> Self {
        let mut tally = Self::default();
        for (s, d) in source
            .as_chunks::<4>()
            .0
            .iter()
            .zip(decoded.as_chunks::<4>().0)
        {
            for channel in (0..4).filter(|&c| channels[c]) {
                let gap = s[channel].abs_diff(d[channel]);
                tally.squared += u64::from(gap) * u64::from(gap);
                tally.samples += 1;
                tally.max_delta = tally.max_delta.max(gap);
            }
            if flipped(s[3], d[3], cutoffs) {
                tally.flips += 1;
            }
        }
        tally
    }
    fn merge(self, other: Self) -> Self {
        Self {
            squared: self.squared + other.squared,
            samples: self.samples + other.samples,
            max_delta: self.max_delta.max(other.max_delta),
            flips: self.flips + other.flips,
        }
    }
    fn measure(self) -> Measure {
        Measure {
            squared: self.squared as f64,
            samples: self.samples,
            max_delta: self.max_delta,
            flips: self.flips,
        }
    }
}

/// Whether a texel whose source alpha is `source` and whose read-back is `back` changed side of
/// one of `cutoffs`.
fn flipped(source: u8, back: u8, cutoffs: &[Cut]) -> bool {
    cutoffs.iter().any(|&c| keeps(source, c) != keeps(back, c))
}

/// Encodes every level of a chain in `codec` — one family and layout — at `effort`, and measures
/// the read-back of each: the blocks, level by level, and the measure. `sizes` gives each level's
/// dimensions in chain order. `Fast` is the fast chain (`fast_chain`); an upper rung the chain
/// searched at it on top of the fast one (`slow_chain`), what a chain whose fast read-back failed
/// the gate is cooked as.
pub fn encode_chain(
    levels: &[impl AsRef<[u8]>],
    sizes: &[(u32, u32)],
    codec: (BlockFormat, Layout),
    effort: Effort,
    channels: Channels,
    cutoffs: &[Cut],
) -> (Vec<Vec<u8>>, Measure) {
    let fast = fast_chain(levels, sizes, codec, channels, cutoffs);
    match effort {
        Effort::Fast => fast,
        upper => slow_chain(levels, sizes, codec, (&fast.0, upper), channels, cutoffs),
    }
}

/// Every block of the chain searched fast, one whose read-back flips a texel across one of
/// `cutoffs` searched again (`sided`): the blocks, level by level, and the measure.
pub fn fast_chain(
    levels: &[impl AsRef<[u8]>],
    sizes: &[(u32, u32)],
    codec: (BlockFormat, Layout),
    channels: Channels,
    cutoffs: &[Cut],
) -> (Vec<Vec<u8>>, Measure) {
    measured(levels, sizes, channels, cutoffs, |_, pixels, size| {
        encode_alike(pixels, size, |_, texels, inside| {
            sided(texels, codec, Effort::Fast, cutoffs, inside)
        })
    })
}

/// The chain searched at `upper` (`Slow`, `Basic`), on top of its fast blocks `fast`
/// (`fast_chain`): each block keeps its upper encoding (`sided`) unless its fast one reads back
/// better inside the level on one of the gate's figures — squared error, largest gap, flips — and
/// no worse on the others; a block whose fast read-back is its source texel for texel is kept
/// fast, unsearched — no search does better. Every block reads back at least as close as the chain
/// searched at `upper` throughout would hold it, so the chain measures at least as well.
pub fn slow_chain(
    levels: &[impl AsRef<[u8]>],
    sizes: &[(u32, u32)],
    codec @ (format, layout): (BlockFormat, Layout),
    (fast, upper): (&[Vec<u8>], Effort),
    channels: Channels,
    cutoffs: &[Cut],
) -> (Vec<Vec<u8>>, Measure) {
    measured(levels, sizes, channels, cutoffs, |level, pixels, size| {
        encode_alike(pixels, size, |block, texels, inside| {
            let kept = fast[level][block * BLOCK_BYTES..]
                .first_chunk::<BLOCK_BYTES>()
                .copied()
                .expect("fast block");
            let source = texel_bytes(texels);
            let back = decode_block(&kept, format, layout);
            if inside_rows(inside).all(|row| source[row.clone()] == back[row]) {
                return (kept, back);
            }
            let slow = sided(texels, codec, upper, cutoffs, inside);
            let [f, s] =
                [&back, &slow.1].map(|b| inside_tally(&source, b, inside, channels, cutoffs));
            let no_worse =
                f.squared <= s.squared && f.max_delta <= s.max_delta && f.flips <= s.flips;
            let better = f.squared < s.squared || f.max_delta < s.max_delta || f.flips < s.flips;
            if no_worse && better {
                (kept, back)
            } else {
                slow
            }
        })
    })
}

/// Each level of the chain encoded by `encode` — its rank, its texels and its size — into its
/// blocks and their read-back, the read-back measured against the level and dropped.
fn measured(
    levels: &[impl AsRef<[u8]>],
    sizes: &[(u32, u32)],
    channels: Channels,
    cutoffs: &[Cut],
    encode: impl Fn(usize, &[u8], (u32, u32)) -> (Vec<u8>, Vec<u8>),
) -> (Vec<Vec<u8>>, Measure) {
    let mut measure = Measure::default();
    let mut blocks = Vec::with_capacity(levels.len());
    for (level, (pixels, &size)) in levels.iter().zip(sizes).enumerate() {
        let pixels = pixels.as_ref();
        let (encoded, decoded) = encode(level, pixels, size);
        measure.add_level(pixels, &decoded, channels, cutoffs);
        blocks.push(encoded);
    }
    (blocks, measure)
}
