//! The `WGP3` geometry page — quantized cluster geometry —: its format, its one encoder, its one
//! decoder. A page lives in two forms. On disk (`disk.rs`, `VERSION`) its triangles are strips, the
//! vertices it shares with other clusters are references to them (`refs.rs`) and every other
//! attribute is a stream of shortest-wrapped zig-zag deltas, split in byte planes, the page's
//! widths and ranges riding in its header; the install pass of the engine
//! (`sdk-browser/src/geometry/pages/install`) transcodes it, on the GPU, into the resident form
//! (`resident.rs`, `RESIDENT_VERSION`) the shaders read in place — the vertices it stores in a
//! first pass, the vertices it names in a second, once the clusters they name are installed. The
//! encoder (`encode.rs`) writes every disk page, the native compiler's and, through the SDK's one
//! WebAssembly module (`wasm/encode.rs`), the run-time cut's; the compiler then gives the pages of
//! a streaming page their references to one another and to the pages it depends on
//! (`refs::share`). The decoder (`unpack.rs`) reads every disk page, the compiler's round-trip
//! test's and, through the same module (`wasm/decode.rs`), the public `page.decode`'s, and
//! `resident::expand` is the CPU twin of the install pass. The constants of this file, `bits.rs`, `deform.rs` and
//! `triangles.rs` are printed into the TypeScript readers and the WGSL built from them
//! (`scripts/build/generate-shared-rules.ts`).
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
pub mod disk;
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
pub mod refs;
pub mod resident;
pub mod simd;
pub mod split;
pub mod streams;
pub mod triangles;
mod unpack;
pub mod voxel;
pub mod writer;

pub use attributes::{DecodedPage, Layout, OPTIONAL, UV_FLAGS, UV_MASK};
use bits::{ColorRange, PositionGrid, UvRange};
pub use deform::{Morph, Skin, FLAG_MORPH, FLAG_SKIN};
#[cfg(test)]
pub use unpack::decode_resident;
pub use unpack::{decode, decode_with};

/// `WGP3` read as a little-endian `u32`: the first word of a page, on disk and resident.
pub const MAGIC: u32 = 0x3350_4757;
/// The geometry-page format a sidecar names, as the manifest's `geometryPages` declares it once and
/// every page on disk opens with. Format 8 adds the stored tangent (`FLAG_TANGENT`); format 9 holds
/// every attribute at the values a mesh build quantizes it to: positions on a grid of centimetres,
/// normals and tangents at their precisions, floating texture codes, byte colours, four texture
/// sets; format 10 writes the page on disk as the streams of its fields' shortest-wrapped zig-zag
/// deltas in byte planes, with the widths and ranges of every field in its header; format 11 writes
/// its triangles as strips and the vertices it shares with other clusters as references to them,
/// which the install pass transcodes into the resident layout of format 9; format 12 carries up to
/// eight texture sets, the ranges of the fifth to the eighth in the header's extension
/// (`Header::extension_words`), which only a page that stores one pays for.
pub const VERSION: u32 = 12;
/// The version word of the resident page, the layout the shaders read in place and the install
/// pass writes: format 10's streams behind a table of their offsets (`RESIDENT_TABLE_WORDS`).
pub const RESIDENT_VERSION: u32 = 11;
/// Words of the table that closes a resident page's header, its morph records and its extension:
/// the word offset, from the page's first word, of every stream a shader reads — block table,
/// corners, the three positions, links, the two normals, the two streams of each of the eight
/// texture sets, the four colours, the tangents, the skin —, two to a word, 16 bits each, the
/// first in the low half (`Layout::table`). The shaders load the offsets they need, never
/// recompute them from the counts and widths.
pub const RESIDENT_TABLE_WORDS: usize = 15;
/// Words that follow a disk page's header and morph records: the vertices it names and the pairs
/// of clusters it names them in, the vertices its strips named and laid before each word of 32
/// triangles, then the byte each section starts at (`disk.rs`, `DiskLayout::words`).
pub const DISK_HEADER_WORDS: usize = 12;
/// How far back among the vertices laid so far a strip names a vertex it reuses, plus one.
pub const STRIP_WINDOW: u32 = 32;
/// Bits of the distance a strip names a vertex it reuses by: the window's.
pub const STRIP_REF_BITS: u32 = 5;
/// Bits of the place a pair names a cluster by: the words from the start of its streaming page's
/// place in the pool to the cluster's resident page, below the rank of that streaming page in the
/// page's list of dependencies (0 for its own).
pub const REF_PLACE_BITS: u32 = 24;
/// The pair that names the page itself: its own earlier vertices, a vertex a strip laid twice.
pub const SELF_PLACE: u32 = (1 << REF_PLACE_BITS) - 1;
/// The start, in words of the pool, of a streaming page that is not resident: no cluster of it is
/// named.
pub const NO_UNIT: u32 = 0xFFFFFFFF;
/// The most triangles and vertices a page holds, and the corners of its triangles: a cluster's,
/// which the install pass (one workgroup a page) transcodes in shared memory.
pub const MAX_PAGE_TRIANGLES: usize = 128;
pub const MAX_PAGE_VERTICES: usize = 256;
pub const MAX_PAGE_CORNERS: usize = 3 * MAX_PAGE_TRIANGLES;
/// Twenty-three little-endian words open a page: counts, flags, the grid of its positions, the
/// ranges of its first four texture sets and of its colour, the precisions of its normals and
/// tangents, the bits of the corner stream, the count of distinct positions, and the deformation
/// word: the skin record and the morph target count (`deform.rs`), zero on a page that carries
/// neither. The morph targets' records follow, then the ranges of the texture sets past the fourth
/// the page carries (`UV_EXTENSION_WORDS` words each, in set order).
pub const HEADER_WORDS: usize = 23;
/// Words of the header's extension a texture set past the fourth takes: its two ranges.
pub const UV_EXTENSION_WORDS: usize = 2;
pub const HEADER_BYTES: usize = HEADER_WORDS * 4;
/// Vertices the test-only reading of a resident page accepts at most (`Header::parse_resident`);
/// a page on disk, which the install pass transcodes, holds `MAX_PAGE_VERTICES`.
#[cfg(test)]
pub const MAX_VERTICES: usize = 65_535;
/// Attribute presence bits: normal, first and second texture coordinate, colour; then the skin
/// and the morph targets (`deform.rs`), the stored tangent (`FLAG_TANGENT`), the third and
/// fourth texture coordinates (`FLAG_UV2`, `FLAG_UV3`) and the fifth to the eighth (`FLAG_UV4` to
/// `FLAG_UV7`).
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
/// The presence bits of the fifth to the eighth texture sets.
pub const FLAG_UV4: u32 = 2048;
pub const FLAG_UV5: u32 = 4096;
pub const FLAG_UV6: u32 = 8192;
pub const FLAG_UV7: u32 = 16384;
/// The presence bits of the fifth to the eighth texture sets together: the sets whose ranges the
/// header's extension holds, `UV_EXTENSION_WORDS` words each.
pub const FLAG_UV_EXTENDED: u32 = FLAG_UV4 + FLAG_UV5 + FLAG_UV6 + FLAG_UV7;
pub const FLAGS_ALL: u32 = 32511;
/// Texture sets a page carries at most.
pub const MAX_UV_SETS: usize = 8;
/// The texture sets whose ranges the fixed header holds, words 9 to 16: the sets past them have
/// theirs in the extension, a page that has none pays nothing for them.
pub const HEADER_UV_SETS: usize = 4;
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

/// A page header, once its twenty-three words, the records of its morph targets and the ranges of
/// its texture sets past the fourth have been read and every bound accepted.
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
    /// The header as its words under `version`, morph records included — and, under
    /// `RESIDENT_VERSION`, the table of the streams' offsets —, the exact inverse of
    /// `parse` for `VERSION` and of `parse_resident` for `RESIDENT_VERSION`.
    pub fn words(&self, version: u32) -> Vec<u32> {
        let mut w = vec![0u32; HEADER_WORDS];
        w[..5].copy_from_slice(&[
            MAGIC,
            version,
            self.vertex_count as u32,
            self.index_count as u32,
            self.flags,
        ]);
        w[5] = self.position.packed();
        w[6..9].copy_from_slice(&self.position.start.map(|cell| cell as u32));
        for (set, range) in self.uv[..HEADER_UV_SETS].iter().enumerate() {
            w[9 + 2 * set..11 + 2 * set].copy_from_slice(&range.words());
        }
        w[17] = self.color.min_word();
        w[18] = self.color.bits_word() | self.normal_precision << 16 | self.tangent_precision << 20;
        w[19] = self.corner_bits as u32;
        w[20] = self.position_count as u32;
        w[21] = deform::word(&self.skin, self.morphs.len());
        w[22] = self.skin.influences as u32;
        w.extend(self.morphs.iter().flat_map(Morph::words));
        w.extend(self.extended_sets().flat_map(|set| self.uv[set].words()));
        if version == RESIDENT_VERSION {
            w.extend(Layout::of(self).table());
        }
        w
    }
}

pub mod cut;
#[cfg(test)]
mod golden;
pub(crate) mod header;
#[cfg(target_arch = "wasm32")]
pub(crate) mod wasm;
