//! The `WGP3` geometry page — quantized cluster geometry —: its format, its one encoder, its one
//! decoder. The encoder (`encode.rs`) writes every page, the native compiler's and, through the
//! SDK's one WebAssembly module (`wasm/encode.rs`), the run-time cut's; the decoder (`unpack.rs`)
//! reads every page, the compiler's round-trip test's and, through the same module
//! (`wasm/decode.rs`), the public `page.decode`'s. The constants of this file,
//! `bits.rs`, `deform.rs` and `triangles.rs` are printed into the TypeScript readers and the WGSL
//! built from them (`scripts/build/generate-shared-rules.ts`).
//!
//! The keep-set, by build. The `rlib` is the native compiler's: the page codec and every kernel
//! below. The `cdylib` is the SDK's one WebAssembly module, `kernels.wasm` (`pnpm run build:wasm`,
//! one shipped resource, one instantiation and one linear memory on the browser side): the page
//! encoder (`wasm/encode.rs`) and the grid rule of a cut's clusters (`wasm/grid.rs`), the page
//! decoder (`wasm/decode.rs`), the math-foundation batch kernels (`math.rs` and
//! `trillion3d_math::matrix`, ABI and shared buffer in `wasm/math.rs`), and the one hand-off of
//! the answers sized only once built (`wasm/held.rs`).
mod attributes;
pub mod balls;
pub mod bits;
pub mod clusters;
pub mod culling;
pub mod deform;
pub mod edges;
pub mod encode;
pub mod facts;
#[cfg(test)]
mod fixtures;
pub mod hash;
mod page_error;
pub use page_error::PageError;
pub mod faces;
pub mod min_ball;
pub mod partition;
mod positions;
pub mod proxy;
pub mod simd;
pub mod split;
pub mod triangles;
mod unpack;
pub mod voxel;
pub mod writer;

pub use attributes::{DecodedPage, Layout, OPTIONAL, UV_FLAGS};
use bits::{ColorRange, PositionGrid, UvRange};
pub use deform::{Morph, Skin, FLAG_MORPH, FLAG_SKIN};
pub use unpack::decode;

pub const MAGIC: u32 = 0x3350_4757;
/// The geometry-page format a version-11 sidecar names, as the manifest's `geometryPages` declares
/// it once and every page header opens with. Format 8 adds the stored tangent (`FLAG_TANGENT`);
/// format 9 holds every attribute at the values a mesh build quantizes it to: positions on a grid of
/// centimetres, normals and tangents at their precisions, floating texture codes, byte colours,
/// four texture sets.
pub const VERSION: u32 = 9;
/// Twenty-three little-endian words open a page: counts, flags, the grid of its positions, the
/// ranges of its four texture sets and of its colour, the precisions of its normals and tangents,
/// the bits of the corner stream, the count of distinct positions, and the deformation word: the
/// skin record and the morph target count (`deform.rs`), zero on a page that carries neither.
pub const HEADER_WORDS: usize = 23;
pub const HEADER_BYTES: usize = HEADER_WORDS * 4;
pub const MAX_VERTICES: usize = 65_535;
/// Attribute presence bits: normal, first and second texture coordinate, colour; then the skin
/// and the morph targets (`deform.rs`).
pub const FLAG_NORMAL: u32 = 1;
pub const FLAG_UV: u32 = 2;
pub const FLAG_UV1: u32 = 4;
pub const FLAG_COLOR: u32 = 8;
/// The index/weight streams name simulated vertices, never joints. Requires FLAG_SKIN.
pub const FLAG_SOFT_SOURCE: u32 = 64;
/// The tangent the source stored, which a reader takes in place of the frame it would rebuild from
/// the triangle: its angle around the vertex's decoded normal and its bitangent's sign, one field of
/// the page's tangent precision plus one bits per vertex (`bits::tangent_code`). Requires
/// FLAG_NORMAL.
pub const FLAG_TANGENT: u32 = 128;
/// The presence bits of the third and fourth texture sets. Bit 256 is the geometry descriptor's
/// flag of a voxel page (`voxel::GEOMETRY_VOXEL`), never a page attribute's.
pub const FLAG_UV2: u32 = 512;
pub const FLAG_UV3: u32 = 1024;
pub const FLAGS_ALL: u32 = 1791;
/// Texture sets a page carries at most.
pub const MAX_UV_SETS: usize = 4;
/// Positions are quantized in centimetres of the mesh's own space, which a metre holds this many of.
pub const CENTIMETRES_PER_METRE: u32 = 100;
/// The least and the greatest precision of a position grid, whose step is `2^-precision`
/// centimetre, and the bits an axis of one page spans at most.
pub const MIN_POSITION_PRECISION: i32 = -20;
pub const MAX_POSITION_PRECISION: i32 = 43;
pub const MAX_POSITION_BITS: u32 = 21;
/// The finest position precision a grid chosen from the mesh's clusters starts from: a step of a
/// sixteenth of a centimetre.
pub const AUTO_MIN_POSITION_PRECISION: i32 = 4;
/// The greatest bits per axis of a normal and of a tangent's angle, and the precisions a mesh that
/// names none takes.
pub const MAX_NORMAL_PRECISION: u32 = 15;
pub const MAX_TANGENT_PRECISION: u32 = 12;
pub const DEFAULT_NORMAL_PRECISION: u32 = 8;
pub const DEFAULT_TANGENT_PRECISION: u32 = 7;
/// A texture coordinate is a float code of one sign bit, `UV_EXPONENT_BITS` of exponent and
/// `UV_MANTISSA_BITS` of mantissa, the values under 1 evenly spaced (`bits::uv_code`).
pub const UV_EXPONENT_BITS: u32 = 5;
pub const UV_MANTISSA_BITS: u32 = 14;
pub const UV_CODE_BITS: u32 = 1 + UV_EXPONENT_BITS + UV_MANTISSA_BITS;
/// A colour channel is a byte, `COLOR_LEVELS` its greatest value.
pub const COLOR_BITS: u32 = 8;
pub const COLOR_LEVELS: u32 = 255;

/// A page header, once its twenty-three words, and the records of its morph targets, have been
/// read and every bound accepted.
#[derive(Clone, Debug, PartialEq)]
pub struct Header {
    pub vertex_count: usize,
    pub index_count: usize,
    pub flags: u32,
    pub position: PositionGrid,
    /// The range of each texture set's codes; a set the flags do not name holds none.
    pub uv: [UvRange; MAX_UV_SETS],
    /// The range of each colour byte: a constant channel costs no bits.
    pub color: ColorRange,
    /// Bits per axis of the octahedral normals, and of a stored tangent's angle.
    pub normal_precision: u32,
    pub tangent_precision: u32,
    /// Bits of the corner stream (`triangles.rs`): the one stream whose length the counts do not give.
    pub corner_bits: usize,
    /// Positions the page stores, each once: fewer than the vertices when a flat-shaded page
    /// repeats a corner under several normals, a link then naming each vertex's (`positions.rs`).
    pub position_count: usize,
    /// Joints and weights of a skinned page (`FLAG_SKIN`); zero otherwise.
    pub skin: Skin,
    /// The morph targets of a page flagged `FLAG_MORPH`, in stream order; empty otherwise.
    pub morphs: Vec<Morph>,
}

impl Header {
    /// The header as its words, morph records included, the exact inverse of `parse`.
    pub fn words(&self) -> Vec<u32> {
        let mut w = vec![0u32; HEADER_WORDS];
        w[..5].copy_from_slice(&[
            MAGIC,
            VERSION,
            self.vertex_count as u32,
            self.index_count as u32,
            self.flags,
        ]);
        w[5] = self.position.packed();
        w[6..9].copy_from_slice(&self.position.start.map(|cell| cell as u32));
        for (set, range) in self.uv.iter().enumerate() {
            w[9 + 2 * set..11 + 2 * set].copy_from_slice(&range.words());
        }
        w[17] = self.color.min_word();
        w[18] = self.color.bits_word() | self.normal_precision << 16 | self.tangent_precision << 20;
        w[19] = self.corner_bits as u32;
        w[20] = self.position_count as u32;
        w[21] = deform::word(&self.skin, self.morphs.len());
        w[22] = self.skin.influences as u32;
        w.extend(self.morphs.iter().flat_map(Morph::words));
        w
    }
}

pub mod cut;
#[cfg(test)]
mod golden;
pub(crate) mod header;
#[cfg(target_arch = "wasm32")]
pub(crate) mod wasm;
