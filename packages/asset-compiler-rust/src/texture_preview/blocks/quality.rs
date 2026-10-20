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
use super::super::coverage::{keeps, Cut};
use super::decode::decode_block;
use super::{blocks_of, encode_block, fit, BlockFormat, Effort, Layout, BLOCK_BYTES};
use rayon::prelude::*;

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
/// dimensions in chain order. `Fast` is the fast chain (`fast_chain`); `Slow` the slow chain
/// built on it (`slow_chain`), what a chain whose fast read-back failed the gate is cooked as.
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
        Effort::Slow => slow_chain(levels, sizes, codec, &fast.0, channels, cutoffs),
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

/// The chain searched slow, on top of its fast blocks `fast` (`fast_chain`): each block keeps its
/// slow encoding (`sided`) unless its fast one reads back better inside the level on one of the
/// gate's figures — squared error, largest gap, flips — and no worse on the others; a block whose
/// fast read-back is its source texel for texel is kept fast, unsearched — no search does better.
/// Every block reads back at least as close as the chain searched slow throughout would hold it,
/// so the chain measures at least as well.
pub fn slow_chain(
    levels: &[impl AsRef<[u8]>],
    sizes: &[(u32, u32)],
    codec @ (format, layout): (BlockFormat, Layout),
    fast: &[Vec<u8>],
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
            let slow = sided(texels, codec, Effort::Slow, cutoffs, inside);
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

/// The part of block (`bx`, `by`) inside a `width` × `height` level: its columns and its rows,
/// four but at the right and bottom edges.
fn inside_of((width, height): (u32, u32), bx: usize, by: usize) -> (usize, usize) {
    (
        (width as usize - bx * 4).min(4),
        (height as usize - by * 4).min(4),
    )
}

/// The byte ranges of a block's sixteen RGBA8 texels, row-major, its `inside` part covers: one a
/// row.
fn inside_rows((across, down): (usize, usize)) -> impl Iterator<Item = std::ops::Range<usize>> {
    (0..down).map(move |y| y * 16..y * 16 + across * 4)
}

/// A block's texels as RGBA8 bytes, row-major: the floats `fit::block_texels` holds are bytes.
fn texel_bytes(texels: &fit::Texels) -> [u8; 64] {
    std::array::from_fn(|i| texels[i / 4][i % 4] as u8)
}

/// The tally of a block's read-back `back` against its `source` texels, on the part `inside` the
/// level only: what the block adds to the level's measure.
fn inside_tally(
    source: &[u8; 64],
    back: &[u8; 64],
    inside: (usize, usize),
    channels: Channels,
    cutoffs: &[Cut],
) -> Tally {
    inside_rows(inside)
        .map(|row| Tally::of(&source[row.clone()], &back[row], channels, cutoffs))
        .fold(Tally::default(), Tally::merge)
}

/// For each block of a level, the first block with the same sixteen texels — the edge repeated
/// (`fit::block_texels`) — and the same part inside the level: the one searched, whose bytes and
/// read-back the others take, since a block is encoded from its texels alone.
fn first_alike(pixels: &[u8], size @ (width, height): (u32, u32)) -> Vec<u32> {
    use std::collections::HashMap;
    use std::hash::{DefaultHasher, Hash, Hasher};
    let (across, _) = blocks_of(width, height);
    let across = across as usize;
    let count = across * blocks_of(width, height).1 as usize;
    let key = |block: usize| {
        let (bx, by) = (block % across, block / across);
        let texels = fit::block_texels(pixels, width, height, bx as u32, by as u32);
        (texel_bytes(&texels), inside_of(size, bx, by))
    };
    let mut first: HashMap<u64, u32> = HashMap::new();
    (0..count)
        .map(|block| {
            let mine = key(block);
            let mut hasher = DefaultHasher::new();
            mine.hash(&mut hasher);
            let seen = *first.entry(hasher.finish()).or_insert(block as u32);
            // Two blocks whose digests meet but whose texels differ are each searched.
            if seen as usize == block || key(seen as usize) != mine {
                block as u32
            } else {
                seen
            }
        })
        .collect()
}

/// One level encoded block by block by `search` — the block's rank, its texels and its part inside
/// the level, to its bytes and its read-back —, each set of alike blocks searched once
/// (`first_alike`): its blocks, and their read-back. Block rows are searched side by side on the
/// caller's pool, each beside the four rows of read-back it writes; the blocks alike an earlier
/// one then copy its bytes and its read-back. No buffer a block: the level's own two.
fn encode_alike(
    pixels: &[u8],
    size @ (width, height): (u32, u32),
    search: impl Fn(usize, &fit::Texels, (usize, usize)) -> ([u8; BLOCK_BYTES], [u8; 64]) + Sync,
) -> (Vec<u8>, Vec<u8>) {
    let alike = first_alike(pixels, size);
    let (across, down) = blocks_of(width, height);
    let across = across as usize;
    let row_bytes = across * BLOCK_BYTES;
    let texel_row = width as usize * 4;
    let mut encoded = vec![0u8; row_bytes * down as usize];
    let mut decoded = vec![0u8; pixels.len()];
    encoded
        .par_chunks_mut(row_bytes)
        .zip(decoded.par_chunks_mut(texel_row * 4))
        .enumerate()
        .with_min_len(8)
        .for_each(|(by, (blocks, rows))| {
            for (bx, block) in blocks
                .as_chunks_mut::<BLOCK_BYTES>()
                .0
                .iter_mut()
                .enumerate()
            {
                let rank = by * across + bx;
                if alike[rank] as usize != rank {
                    continue;
                }
                let texels = fit::block_texels(pixels, width, height, bx as u32, by as u32);
                let (kept, back) = search(rank, &texels, inside_of(size, bx, by));
                *block = kept;
                put_block(rows, width, bx, &back);
            }
        });
    for (rank, &seen) in alike.iter().enumerate() {
        let seen = seen as usize;
        if seen == rank {
            continue;
        }
        encoded.copy_within(
            seen * BLOCK_BYTES..(seen + 1) * BLOCK_BYTES,
            rank * BLOCK_BYTES,
        );
        let (bx, by) = (rank % across, rank / across);
        let (sx, sy) = (seen % across, seen / across);
        let (columns, rows) = inside_of(size, bx, by);
        for y in 0..rows {
            let from = (sy * 4 + y) * texel_row + sx * 16;
            let to = (by * 4 + y) * texel_row + bx * 16;
            decoded.copy_within(from..from + columns * 4, to);
        }
    }
    (encoded, decoded)
}

/// Block `bx`'s read-back `back`, sixteen texels row-major, written over `rows`, the four rows or
/// fewer of a `width`-texel RGBA8 level its block row covers: the texels inside the level only.
fn put_block(rows: &mut [u8], width: u32, bx: usize, back: &[u8; 64]) {
    let row_bytes = width as usize * 4;
    for (y, row) in rows.chunks_mut(row_bytes).enumerate() {
        for x in (bx * 4..bx * 4 + 4).filter(|&x| x < width as usize) {
            let texel = y * 4 + x - bx * 4;
            row[x * 4..x * 4 + 4].copy_from_slice(&back[texel * 4..texel * 4 + 4]);
        }
    }
}

/// Rounds a block that flips a texel is encoded again at most (`sided`).
const SIDE_ROUNDS: usize = 3;

/// One block of `texels` in `codec` at `effort`, and its read-back. What a cut reads of a texel is
/// its side, and an encoder minimises squared error: an alpha one step under a cutoff can come
/// back one step over it — a 4-bit BC7 weight between 0 and 255 lands on 119 or 135, never 127 —,
/// a hole that closes. A block whose read-back flips a texel `inside` the level across one of
/// `cutoffs` is encoded again from its texels, each flipped alpha pushed away from the cut by the
/// error it came back with, round after round while a texel still flips; a round's block is kept
/// only when it flips fewer of its sixteen texels, and only a kept round's read-back steers the
/// next push. Measured against the source, as every block is.
fn sided(
    texels: &fit::Texels,
    (format, layout): (BlockFormat, Layout),
    effort: Effort,
    cutoffs: &[Cut],
    inside: (usize, usize),
) -> ([u8; BLOCK_BYTES], [u8; 64]) {
    let mut block = encode_block(texels, format, layout, effort);
    let mut back = decode_block(&block, format, layout);
    if cutoffs.is_empty() {
        return (block, back);
    }
    let source = texel_bytes(texels);
    let flips_at = |back: &[u8; 64], t: usize| flipped(source[t * 4 + 3], back[t * 4 + 3], cutoffs);
    let (columns, rows) = inside;
    if !(0..16).any(|t| t % 4 < columns && t / 4 < rows && flips_at(&back, t)) {
        return (block, back);
    }
    let count = |back: &[u8; 64]| (0..16).filter(|&t| flips_at(back, t)).count();
    let mut best = count(&back);
    let mut nudged = *texels;
    for _ in 0..SIDE_ROUNDS {
        for t in (0..16).filter(|&t| flips_at(&back, t)) {
            let error = f32::from(back[t * 4 + 3]) - f32::from(source[t * 4 + 3]);
            nudged[t][3] = (nudged[t][3] - error).clamp(0.0, 255.0);
        }
        let again = encode_block(&nudged, format, layout, effort);
        let again_back = decode_block(&again, format, layout);
        let flips = count(&again_back);
        if flips < best {
            (best, block, back) = (flips, again, again_back);
        }
        if best == 0 {
            break;
        }
    }
    (block, back)
}
