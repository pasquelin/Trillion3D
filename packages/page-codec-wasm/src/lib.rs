//! The `WGP3` geometry page — quantized cluster geometry —: its format, its one encoder, its one
//! decoder. The encoder (`encode.rs`) writes every page, the native compiler's and, through the
//! SDK's one WebAssembly module (`wasm_encode.rs`), the run-time cut's; the decoder (`unpack.rs`)
//! reads every page, the compiler's round-trip test's and, through the same module
//! (`wasm_decode.rs`), the public `page.decode`'s. The constants of this file,
//! `bits.rs`, `deform.rs`, `triangles.rs` and `bits/grid.rs` are printed into the TypeScript
//! readers and the WGSL built from them (`scripts/generate-shared-rules.ts`).
//!
//! The keep-set, by build. The `rlib` is the native compiler's: the page codec and every kernel
//! below. The `cdylib` is the SDK's one WebAssembly module, `kernels.wasm` (`pnpm run build:wasm`,
//! one shipped resource, one instantiation and one linear memory on the browser side): the page
//! encoder and the grid rules (`wasm_encode.rs`), the page decoder (`wasm_decode.rs`), the math-foundation batch kernels (`math.rs` and
//! `trillion3d_math::matrix`, ABI and shared buffer in `wasm_math.rs`), the normal cone of the
//! pages the world cuts at run time (`normal_cone.rs`, `wasm_cone.rs`), and the one hand-off of
//! the answers sized only once built (`held.rs`).
mod attributes;
pub mod bits;
pub mod clusters;
pub mod culling;
pub mod cut_error;
pub mod deform;
pub mod encode;
#[doc(hidden)]
pub mod fixtures;
pub mod hash;
mod header_parse;
#[cfg(target_arch = "wasm32")]
mod held;
mod page_error;
pub use page_error::PageError;
pub mod math;
pub mod min_ball;
pub mod normal_cone;
mod positions;
pub mod proxy;
pub mod simd;
pub mod split;
pub mod triangles;
mod unpack;
#[cfg(target_arch = "wasm32")]
mod wasm_clusters;
#[cfg(target_arch = "wasm32")]
mod wasm_cone;
#[cfg(target_arch = "wasm32")]
mod wasm_culling;
#[cfg(target_arch = "wasm32")]
mod wasm_decode;
#[cfg(target_arch = "wasm32")]
mod wasm_encode;
#[cfg(target_arch = "wasm32")]
mod wasm_math;
#[cfg(target_arch = "wasm32")]
mod wasm_proxy;
pub mod writer;

pub use attributes::{DecodedPage, Layout, OPTIONAL};
use bits::Quant;
pub use deform::{Morph, Skin, FLAG_MORPH, FLAG_SKIN};
pub use unpack::decode;

pub const MAGIC: u32 = 0x3350_4757;
/// The geometry-page format a version-11 sidecar names, as the manifest's `geometryPages` declares
/// it once and every page header opens with.
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
}

#[cfg(test)]
#[path = "header_tests.rs"]
mod header_tests;

#[cfg(test)]
mod golden_tests;
