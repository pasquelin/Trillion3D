//! Block compression of a baked level, at cook time, in the three families a
//! WebGPU adapter may sample: BC for the desktop graphics cards, ASTC 4 × 4 and
//! ETC2 for the mobile ones, one byte per texel in each against four for RGBA8.
//! BC is the STORED family: the levels above the tail are written in it, and a
//! device that samples no BC block decodes it to RGBA8 (the engine's
//! `texture/blockDecode.ts`); ASTC and ETC2 are cooked beside it on demand
//! (`--textures-format=`). Every block is encoded once: BC7 with the basic search
//! (`bc7_settings`), every other codec its one way. A chain whose read-back misses
//! the gate (`quality.rs`) is left out of ASTC and ETC2; the stored BC chain is
//! kept whatever it measures, the report giving its figures. What the sidecar
//! and the level files carry is what the gate kept.
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
mod bc4;
mod bc5;
mod bc6h;
mod channel;
pub mod decode;
mod eac;
pub(crate) mod eac_modifiers;
mod etc2;
mod etc2_planar;
mod fit;
mod gray;
mod ise;
mod layout;
pub mod quality;
#[cfg(test)]
mod tests;
mod texels;

pub use bc4::encode_level as encode_one_channel;
pub use bc6h::encode_level as encode_hdr;
pub use gray::encode_level as encode_channel;
pub use layout::Layout;
pub use texels::encode_texels;

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
            (Self::Bc7, Layout::Hdr) => "bc6h",
            (Self::Bc7, Layout::OneChannel) => "bc4",
            (Self::Bc7, Layout::Gray) => "g8",
            (Self::Bc7, Layout::Displacement) => "a8",
            (Self::Bc7, Layout::Float32) => "rgba32f",
            (Self::Bc7, Layout::SingleFloat) => "r32f",
            (Self::Bc7, Layout::HalfSingle) => "r16f",
            (Self::Astc, Layout::Rgba) => "astc",
            (Self::Astc, Layout::TwoChannel) => "astc-la",
            (Self::Etc2, Layout::Rgba) => "etc2",
            (Self::Etc2, Layout::TwoChannel) => "eac-rg",
            // Only BC holds the explicit settings' chains: the others are never written.
            (
                Self::Astc | Self::Etc2,
                Layout::Hdr
                | Layout::OneChannel
                | Layout::Gray
                | Layout::Displacement
                | Layout::Float32
                | Layout::SingleFloat
                | Layout::HalfSingle,
            ) => "none",
        }
    }
    /// Whether the family has a codec for `layout`: the explicit settings' layouts (`Layout::Hdr`,
    /// `Layout::OneChannel`) are BC's alone.
    pub const fn holds(self, layout: Layout) -> bool {
        matches!(self, Self::Bc7) || layout.gated()
    }
}

/// The encoder settings, spelled: BC7's, opaque then alpha (`bc7_settings`) — every other codec
/// has none. A chain's key holds them (`GateSheet::key`), so a setting that changes never reads a
/// level file another one wrote.
pub fn encoding() -> String {
    format!("bc7:{:?}/{:?}", bc7_settings(true), bc7_settings(false))
}

/// Compressed bytes of a `width` × `height` level in `layout`: the one 4 × 4 block surface count
/// (`surface_bytes`) at the layout's bytes a block.
pub fn layout_block_bytes(width: u32, height: u32, layout: Layout) -> usize {
    surface_bytes(width, height, layout.block_bytes() as u64) as usize
}

/// The same for the layouts of sixteen-byte blocks, which is every one the gate writes.
pub fn level_block_bytes(width: u32, height: u32) -> usize {
    layout_block_bytes(width, height, Layout::Rgba)
}

/// Compresses one block in BC7 by `block_compression`: a block whose every alpha is 255 is
/// searched in the opaque modes, faster and as exact; any other in the alpha ones. The texels are
/// bytes held as floats (`fit::block_texels`, edge repeated), given back exactly.
fn bc7_block(texels: &fit::Texels) -> [u8; 16] {
    use block_compression::{encode::compress_rgba8, CompressionVariant};
    let rgba: [u8; 64] = std::array::from_fn(|i| texels[i / 4][i % 4] as u8);
    let opaque = texels.iter().all(|texel| texel[3] == 255.0);
    let mut block = [0u8; 16];
    compress_rgba8(
        CompressionVariant::BC7(bc7_settings(opaque)),
        &rgba,
        &mut block,
        4,
        4,
        16,
    );
    block
}

/// The BC7 encoder's settings for an opaque block or not: the basic search, every mode tried, two
/// refinements.
fn bc7_settings(opaque: bool) -> block_compression::BC7Settings {
    use block_compression::BC7Settings;
    if opaque {
        BC7Settings::opaque_basic()
    } else {
        BC7Settings::alpha_basic()
    }
}

/// Compresses one block — sixteen texels, edge repeated (`fit::block_texels`) — in one family and
/// layout: the one block encoder of a chain (`quality.rs`).
pub(super) fn encode_block(
    texels: &fit::Texels,
    format: BlockFormat,
    layout: Layout,
) -> [u8; BLOCK_BYTES] {
    match (format, layout) {
        (BlockFormat::Bc7, Layout::Rgba) => bc7_block(texels),
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
        _ => unreachable!("the explicit layouts are written beside the gate"),
    }
}

/// Compresses one RGBA8 level in one family and layout: the codecs proved alone, block by block
/// (`encode_block`) — a chain is cooked by `quality::encode_chain`. Blocks are written in place,
/// block rows in parallel on the caller's pool.
#[cfg(test)]
pub fn encode_level(
    rgba: &[u8],
    width: u32,
    height: u32,
    format: BlockFormat,
    layout: Layout,
) -> Vec<u8> {
    fit::encode_blocks(rgba, (width, height), BLOCK_BYTES, |texels, out| {
        out.copy_from_slice(&encode_block(texels, format, layout));
    })
}
