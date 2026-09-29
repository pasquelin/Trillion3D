//! Decoder of a `WGP3` geometry page — quantized cluster geometry —, exact mirror of
//! `packages/sdk-browser/src/page/decode/geometryPage.ts` and of the WGSL routines of
//! `packages/sdk-browser/src/cluster/decodeWgsl.ts`.
//!
//! The same code serves two hosts: the native compiler, which encodes with the format's own
//! definitions (`bits.rs`) and proves that what it writes rereads identically, and the
//! `wasm32-unknown-unknown` module loaded by the browser. Refusals carry the same causes, in the
//! same order, as the JavaScript decoder: a byte that passes here passes there, a byte that falls
//! here falls there.
//!
//! This WebAssembly module is the SDK's, and there is only one: one compilation (`pnpm run
//! build:wasm`), one shipped resource, one instantiation and one linear memory on the browser side.
//! Beside the page decoder it therefore carries the math-foundation batch kernels (`math.rs`, ABI
//! in `wasm_math.rs`), the CPU cut's node walk (`cut.rs`, ABI in `wasm_cut.rs`), the normal cone
//! and position grid of the pages the world cuts at run time (`normal_cone.rs`, `bits/grid.rs`,
//! ABI in `wasm_cone.rs`) and the buffer they share with JavaScript.
mod attributes;
pub mod bits;
pub mod cut;
pub mod cut_error;
pub mod deform;
pub mod math;
pub mod math_hierarchy;
pub mod min_ball;
pub mod normal_cone;
mod positions;
pub mod triangles;
mod unpack;
pub mod vec3;
#[cfg(target_arch = "wasm32")]
mod wasm;
#[cfg(target_arch = "wasm32")]
mod wasm_cone;
#[cfg(target_arch = "wasm32")]
mod wasm_cut;
#[cfg(target_arch = "wasm32")]
mod wasm_math;
pub mod writer;

pub use attributes::{DecodedPage, Layout, OPTIONAL};
use bits::Quant;
pub use deform::{Morph, Skin, FLAG_MORPH, FLAG_SKIN};
pub use unpack::decode;

pub const MAGIC: u32 = 0x3350_4757;
pub const VERSION: u32 = 7;
/// Twenty-five little-endian words open a page: counts, flags, the quantization records of the
/// four vector attributes, the error, the bits of the corner stream, the count of distinct
/// positions, and the deformation word: the skin record and the morph target count
/// (`deform.rs`), zero on a page that carries neither.
pub const HEADER_WORDS: usize = 25;
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
pub const FLAGS_ALL: u32 = 127;

/// Refusal causes, in the order the JavaScript decoder raises them. The numeric values cross the
/// WebAssembly ABI: the JS loader retranslates them into `GEOMETRY_PAGE_*` messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum PageError {
    Header = 1,
    Version = 2,
    Bounds = 3,
    Index = 4,
}

/// A page header, once its twenty-five words, and the records of its morph targets, have been
/// read and every bound accepted.
#[derive(Clone, Debug, PartialEq)]
pub struct Header {
    pub vertex_count: usize,
    pub index_count: usize,
    pub flags: u32,
    pub position: Quant<3>,
    pub uv: Quant<2>,
    pub uv1: Quant<2>,
    /// Colour on a fixed grid of 2^-8: a constant channel costs no bits.
    pub color: Quant<4>,
    /// Largest distance, in object units, between a source position and its decoded value.
    pub quantization_error: f32,
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
        w[6..9].copy_from_slice(&self.position.min.map(f32::to_bits));
        w[9] = self.uv.packed();
        w[10..12].copy_from_slice(&self.uv.min.map(f32::to_bits));
        w[12] = self.uv1.packed();
        w[13..15].copy_from_slice(&self.uv1.min.map(f32::to_bits));
        w[15] = self.color.packed();
        w[16..20].copy_from_slice(&self.color.min.map(f32::to_bits));
        w[20] = self.quantization_error.to_bits();
        w[21] = self.corner_bits as u32;
        w[22] = self.position_count as u32;
        w[23] = deform::word(&self.skin, self.morphs.len());
        w[24] = self.skin.influences as u32;
        w.extend(self.morphs.iter().flat_map(Morph::words));
        w
    }

    /// The header words and the JS decoder's bounds, refused in the same order; the byte
    /// length must be exactly what the streams need and the decoded page under the budget.
    pub fn parse(data: &[u8], max_decoded_bytes: usize) -> Result<Self, PageError> {
        if data.len() < HEADER_BYTES {
            return Err(PageError::Header);
        }
        let mut w = [0u32; HEADER_WORDS];
        for (word, value) in w.iter_mut().zip(bits::le_words(&data[..HEADER_BYTES])) {
            *word = value;
        }
        if w[0] != MAGIC || w[1] != VERSION {
            return Err(PageError::Version);
        }
        let f = f32::from_bits;
        let records = (
            Quant::unpack(w[5], [f(w[6]), f(w[7]), f(w[8])]),
            Quant::unpack(w[9], [f(w[10]), f(w[11])]),
            Quant::unpack(w[12], [f(w[13]), f(w[14])]),
            Quant::unpack(w[15], [f(w[16]), f(w[17]), f(w[18]), f(w[19])]),
        );
        let (Some(position), Some(uv), Some(uv1), Some(color)) = records else {
            return Err(PageError::Bounds);
        };
        let Some((skin, morphs)) = deform::parse(w[4], w[23], data) else {
            return Err(PageError::Bounds);
        };
        let header = Self {
            vertex_count: w[2] as usize,
            index_count: w[3] as usize,
            flags: w[4],
            position,
            uv,
            uv1,
            color,
            quantization_error: f(w[20]),
            corner_bits: w[21] as usize,
            position_count: w[22] as usize,
            skin,
            morphs,
        };
        let layout = Layout::of(&header);
        let (table, v, n) = (layout.triangles[1] * 4, w[2] as usize, w[3] as usize);
        let sane = (1..=MAX_VERTICES).contains(&header.vertex_count)
            && (1..=header.vertex_count).contains(&header.position_count)
            && (3..=max_decoded_bytes / 4).contains(&header.index_count)
            && header.index_count.is_multiple_of(3)
            && header.corner_bits <= header.index_count.saturating_mul(triangles::MAX_WIDTH)
            && header.flags & !FLAGS_ALL == 0
            && (header.flags & FLAG_SOFT_SOURCE == 0 || header.flags & FLAG_SKIN != 0)
            && header.quantization_error.is_finite()
            && header.quantization_error >= 0.0
            && header.decoded_bytes() <= max_decoded_bytes
            && layout.bytes() == data.len()
            && layout.morphs_at(&header)
            && deform::finite(&data[header.bytes()..], &header, &layout)
            && layout.corners.fits(&data[header.bytes()..][..table], v, n)
            && positions::links_fit(&data[header.bytes()..], &layout, &header);
        if !sane {
            return Err(PageError::Bounds);
        }
        Ok(header)
    }
}

#[cfg(test)]
#[path = "header_tests.rs"]
mod header_tests;
