//! Block compression of a baked level, at cook time, in the three families a
//! WebGPU adapter may sample: BC for the desktop graphics cards, ASTC 4 × 4 and
//! ETC2 for the mobile ones, one byte per texel in each against four for RGBA8.
//! BC is the STORED family: the levels above the tail are written in it, and a
//! device that samples no BC block decodes it to RGBA8 (the engine's
//! `texture/blockDecode.ts`); ASTC and ETC2 are cooked beside it on demand
//! (`--textures-format=`). Every family is kept only where its read-back passes
//! the gate (`quality.rs`): a BC7 chain whose fast read-back fails it is encoded
//! again whole with the slow search (`Effort`), each block keeping its slow
//! encoding unless its fast one reads back better on every bar. A chain that
//! still misses them is left out of ASTC and ETC2;
//! the stored BC chain is kept whatever it measures, the report giving its
//! figures. What the sidecar and the level files carry is what the gate kept.
//!
//! A family writes two layouts: RGBA (BC7 — every mode searched by
//! `block_compression` —, ASTC colour endpoint mode 12, ETC2 RGBA8) for colour
//! and data maps, and TWO CHANNELS (BC5, ASTC
//! luminance and alpha on two weight planes, EAC RG11) for a normal map, whose
//! X and Y vary in directions of their own that one RGBA segment cannot hold;
//! the shader rebuilds Z. A level is cut into 4 × 4 blocks, row-major, sixteen
//! bytes each; a side that is not a multiple of four is padded by repeating its
//! edge, and the padded blocks are part of the level's bytes — WebGPU copies
//! whole blocks.
use crate::plugins::image::blocks::{blocks_of, surface_bytes};

mod astc;
mod astc_la;
mod bc5;
mod channel;
pub mod decode;
mod eac;
mod etc2;
mod etc2_planar;
mod fit;
mod ise;
pub mod quality;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_etc2;
#[cfg(test)]
mod tests_two_channel;

/// Bytes of one compressed block, in every format.
pub const BLOCK_BYTES: usize = 16;

/// The families a cook can write, in the order the sidecar columns carry
/// them. A family is named by its RGBA codec — `bc7`, `astc`, `etc2` — on the
/// command line, in the manifest and in the engine's choice.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BlockFormat {
    Bc7,
    Astc,
    Etc2,
}
/// How many families there are: the block columns, layout words and tails of an entry.
pub const FAMILIES: usize = BlockFormat::ALL.len();
impl BlockFormat {
    pub const ALL: [BlockFormat; 3] = [BlockFormat::Bc7, BlockFormat::Astc, BlockFormat::Etc2];
    pub const fn name(self) -> &'static str {
        match self {
            Self::Bc7 => "bc7",
            Self::Astc => "astc",
            Self::Etc2 => "etc2",
        }
    }
    pub fn named(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|format| format.name() == name)
    }
    /// The family the levels above the tail are stored in: the one a device that samples none of
    /// the others decodes.
    pub const STORED: BlockFormat = BlockFormat::Bc7;
    /// Rank in `ALL`: the family's column, layout word and tail slot.
    pub fn index(self) -> usize {
        self as usize
    }
    /// The file extension of a level in `layout`, and the name the manifest
    /// template takes. The layout is in the name: a file already there is never
    /// rewritten, and an ASTC block says its own layout only once decoded.
    pub const fn file_name(self, layout: Layout) -> &'static str {
        match (self, layout) {
            (Self::Bc7, Layout::Rgba) => "bc7",
            (Self::Bc7, Layout::TwoChannel) => "bc5",
            (Self::Astc, Layout::Rgba) => "astc",
            (Self::Astc, Layout::TwoChannel) => "astc-la",
            (Self::Etc2, Layout::Rgba) => "etc2",
            (Self::Etc2, Layout::TwoChannel) => "eac-rg",
        }
    }
}

/// How a chain's texels are laid out in a family's blocks. What a sidecar
/// entry says of each family is `Option<Layout>`: `None` is a lossless chain,
/// no blocks written.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Layout {
    Rgba,
    TwoChannel,
}
impl Layout {
    pub fn name(self) -> &'static str {
        match self {
            Self::Rgba => "rgba",
            Self::TwoChannel => "two-channel",
        }
    }
    /// The word a sidecar entry carries: 0 lossless, then the layouts.
    pub fn word(layout: Option<Layout>) -> u32 {
        match layout {
            None => 0,
            Some(Self::Rgba) => 1,
            Some(Self::TwoChannel) => 2,
        }
    }
    /// The inverse: `Some(layout or lossless)`, `None` for a word no layout owns.
    pub fn from_word(word: u32) -> Option<Option<Layout>> {
        match word {
            0 => Some(None),
            1 => Some(Some(Self::Rgba)),
            2 => Some(Some(Self::TwoChannel)),
            _ => None,
        }
    }
}

/// How far an encoder searches each block, the same sixteen bytes a block either way: `Fast`
/// first, `Slow` for a chain whose fast read-back fails the gate (`quality::slow_chain`). Only
/// BC7 RGBA has a search to widen — every mode, more refinement (`BC7Settings::*_slow`) —; every
/// other codec encodes one way, and is tried once.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Effort {
    Fast,
    Slow,
}
impl Effort {
    pub const ALL: [Effort; 2] = [Effort::Fast, Effort::Slow];
    pub fn name(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Slow => "slow",
        }
    }
    pub fn named(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|effort| effort.name() == name)
    }
    /// The efforts a chain is tried at in `format` and `layout`, the fastest first.
    pub fn ladder(format: BlockFormat, layout: Layout) -> &'static [Effort] {
        match (format, layout) {
            (BlockFormat::Bc7, Layout::Rgba) => &Self::ALL,
            _ => &[Self::Fast],
        }
    }
    /// The ladder of `format` and `layout` spelled with each rung's encoder settings — BC7's,
    /// opaque then alpha (`bc7_settings`) —, the slow rung named as keeping a block's better
    /// encoding of the two: a chain's key holds it (`GateSheet::key`), so a ladder, a rule or a
    /// setting that changes never reads a level file another one wrote. Within one ladder the
    /// rung a chain settles on follows from its texels and its sheet alone.
    pub fn spelling(format: BlockFormat, layout: Layout) -> String {
        let rung = |effort: Effort| match (format, layout) {
            (BlockFormat::Bc7, Layout::Rgba) => format!(
                "{}={:?}/{:?}",
                effort.name(),
                bc7_settings(true, effort),
                bc7_settings(false, effort)
            ),
            _ => effort.name().to_string(),
        };
        let rungs: Vec<String> = Self::ladder(format, layout)
            .iter()
            .map(|&e| rung(e))
            .collect();
        let rungs = rungs.join(",best-of-fast ");
        format!("{}:{rungs}", format.file_name(layout))
    }
}

/// Compressed bytes of a `width` × `height` level: the one 4 × 4 block surface count
/// (`surface_bytes`) at `BLOCK_BYTES` a block.
pub fn level_block_bytes(width: u32, height: u32) -> usize {
    surface_bytes(width, height, BLOCK_BYTES as u64) as usize
}

/// Compresses one block in BC7 by `block_compression`, at `effort`: a block whose every alpha is
/// 255 is searched in the opaque modes, faster and as exact; any other in the alpha ones. The
/// texels are bytes held as floats (`fit::block_texels`, edge repeated), given back exactly.
fn bc7_block(texels: &fit::Texels, effort: Effort) -> [u8; 16] {
    use block_compression::{encode::compress_rgba8, CompressionVariant};
    let rgba: [u8; 64] = std::array::from_fn(|i| texels[i / 4][i % 4] as u8);
    let opaque = texels.iter().all(|texel| texel[3] == 255.0);
    let settings = bc7_settings(opaque, effort);
    let mut block = [0u8; 16];
    compress_rgba8(
        CompressionVariant::BC7(settings),
        &rgba,
        &mut block,
        4,
        4,
        16,
    );
    block
}

/// The BC7 encoder's settings for an opaque block or not, at `effort`.
fn bc7_settings(opaque: bool, effort: Effort) -> block_compression::BC7Settings {
    use block_compression::BC7Settings;
    match (opaque, effort) {
        (true, Effort::Fast) => BC7Settings::opaque_very_fast(),
        (true, Effort::Slow) => BC7Settings::opaque_slow(),
        (false, Effort::Fast) => BC7Settings::alpha_fast(),
        (false, Effort::Slow) => BC7Settings::alpha_slow(),
    }
}

/// Compresses one block — sixteen texels, edge repeated (`fit::block_texels`) — in one family and
/// layout, at `effort`: the one block encoder of a chain (`quality.rs`).
pub(super) fn encode_block(
    texels: &fit::Texels,
    format: BlockFormat,
    layout: Layout,
    effort: Effort,
) -> [u8; BLOCK_BYTES] {
    match (format, layout) {
        (BlockFormat::Bc7, Layout::Rgba) => bc7_block(texels, effort),
        (BlockFormat::Astc, Layout::Rgba) => astc::encode(texels, fit::segment(texels)),
        (BlockFormat::Bc7, Layout::TwoChannel) => bc5::encode(texels),
        (BlockFormat::Astc, Layout::TwoChannel) => astc_la::encode(texels),
        (BlockFormat::Etc2, Layout::Rgba) => etc2::encode(texels),
        (BlockFormat::Etc2, Layout::TwoChannel) => {
            let [x, y] = [0, 1].map(|channel| eac::encode(texels, channel));
            let mut block = [0u8; BLOCK_BYTES];
            block[..8].copy_from_slice(&x);
            block[8..].copy_from_slice(&y);
            block
        }
    }
}

/// Compresses one RGBA8 level in one family and layout, every block at `effort`: the codecs
/// proved alone, block by block (`encode_block`) — a chain is cooked by `quality::encode_chain`.
/// Blocks are written in place, block rows in parallel on the caller's pool.
#[cfg(test)]
pub fn encode_level(
    rgba: &[u8],
    width: u32,
    height: u32,
    format: BlockFormat,
    layout: Layout,
    effort: Effort,
) -> Vec<u8> {
    use rayon::prelude::*;
    debug_assert_eq!(rgba.len(), width as usize * height as usize * 4);
    let (across, down) = blocks_of(width, height);
    let row_bytes = across as usize * BLOCK_BYTES;
    let mut out = vec![0u8; row_bytes * down as usize];
    // Block rows are independent; the pool splits them in runs of eight at
    // least, so a small level — the tail, a thumbnail — stays on one thread.
    out.par_chunks_mut(row_bytes)
        .enumerate()
        .with_min_len(8)
        .for_each(|(by, out)| {
            for (bx, out) in out.as_chunks_mut::<BLOCK_BYTES>().0.iter_mut().enumerate() {
                let texels = fit::block_texels(rgba, width, height, bx as u32, by as u32);
                *out = encode_block(&texels, format, layout, effort);
            }
        });
    out
}
