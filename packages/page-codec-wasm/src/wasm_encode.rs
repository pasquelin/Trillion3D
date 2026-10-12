//! Raw ABI of the page encoder (`encode.rs`) for the pages the engine cuts at run time, and of
//! the grid rules (`bits/grid.rs`) that set their exponents: byte offsets into `arena_alloc`
//! reservations, like `wasm_math.rs`. The loader is `packages/sdk-browser/src/page/codec/encode.ts`.
//!
//! A page is written by `encode_page` from one request block of `REQUEST_WORDS` words and left in
//! the module until `encode_page_take` copies it out: its length is known only once written.

use crate::bits::grid::{
    drawn_uv_grid_exponent, primitive_grid_exponent, tile_log2, uv_grid_exponent,
};
use crate::encode::deformation::{Deformation, MorphTarget};
use crate::encode::{encode_deformed, Attribute};
use crate::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};
use std::cell::RefCell;

/// Words of a request block. Offsets are bytes in linear memory, 0 for an absent array.
pub const REQUEST_WORDS: usize = 16;
/// The request's words: `indices` (`index_count` words), `positions` (`vertex_count` × 3 floats),
/// the optional `normals` (× 3), `uv0` and `uv1` (× 2), `colors` (× `color_width`, 3 or 4); the
/// grids `position_exponent` and `uv_exponent` (signed); the skin's `joints` (words) and `weights`
/// (floats), `influences` each per vertex; the morph `targets`, a table of two offsets (position,
/// normal) each over every vertex.
pub mod request {
    pub const INDICES: usize = 0;
    pub const INDEX_COUNT: usize = 1;
    pub const POSITIONS: usize = 2;
    pub const VERTEX_COUNT: usize = 3;
    pub const NORMALS: usize = 4;
    pub const UV0: usize = 5;
    pub const UV1: usize = 6;
    pub const COLORS: usize = 7;
    pub const COLOR_WIDTH: usize = 8;
    pub const POSITION_EXPONENT: usize = 9;
    pub const UV_EXPONENT: usize = 10;
    pub const JOINTS: usize = 11;
    pub const WEIGHTS: usize = 12;
    pub const INFLUENCES: usize = 13;
    pub const TARGET_COUNT: usize = 14;
    pub const TARGETS: usize = 15;
}

/// Words of the block `encode_page` answers in.
pub const META_WORDS: usize = 16;
/// The answer's words on success: the page's `vertex_count`, `index_count`, `flags`, decoded
/// bytes, quantization error (float bits) and byte length. On refusal, word 0 is the length of
/// the refusal's code and its ASCII bytes follow from byte 4.
pub mod meta {
    pub const VERTEX_COUNT: usize = 0;
    pub const INDEX_COUNT: usize = 1;
    pub const FLAGS: usize = 2;
    pub const DECODED_BYTES: usize = 3;
    pub const QUANTIZATION_ERROR: usize = 4;
    pub const BYTES: usize = 5;
}

thread_local! {
    static PAGE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

unsafe fn floats<'a>(offset: u32, count: usize) -> &'a [f32] {
    core::slice::from_raw_parts(offset as *const f32, count)
}

/// Writes the page `request` describes. Returns 0 and fills `meta`, the page waiting for
/// `encode_page_take`; or 1 with the refusal's code in `meta`.
///
/// # Safety
/// `request` and `meta` must lie in live `arena_alloc` reservations of `REQUEST_WORDS` and
/// `META_WORDS` words, and every offset the request names in one holding the counts it states.
#[no_mangle]
pub unsafe extern "C" fn encode_page(request: u32, meta: u32) -> u32 {
    let r = core::slice::from_raw_parts(request as *const u32, REQUEST_WORDS);
    let answer = core::slice::from_raw_parts_mut(meta as *mut u32, META_WORDS);
    let vertices = r[request::VERTEX_COUNT] as usize;
    let indices = core::slice::from_raw_parts(
        r[request::INDICES] as *const u32,
        r[request::INDEX_COUNT] as usize,
    );
    let positions = floats(r[request::POSITIONS], vertices * 3);
    let mut attributes = Vec::new();
    for (word, flag, width) in [
        (request::NORMALS, FLAG_NORMAL, 3),
        (request::UV0, FLAG_UV, 2),
        (request::UV1, FLAG_UV1, 2),
        (
            request::COLORS,
            FLAG_COLOR,
            r[request::COLOR_WIDTH] as usize,
        ),
    ] {
        if r[word] != 0 {
            attributes.push(Attribute {
                flag,
                width,
                values: floats(r[word], vertices * width).to_vec(),
            });
        }
    }
    let carried: Vec<&Attribute> = attributes.iter().collect();
    let influences = r[request::INFLUENCES] as usize;
    let mut deformation = Deformation::default();
    if r[request::JOINTS] != 0 {
        let count = vertices * influences;
        deformation.influences = influences;
        deformation.skin = Some((
            core::slice::from_raw_parts(r[request::JOINTS] as *const u32, count).to_vec(),
            floats(r[request::WEIGHTS], count).to_vec(),
        ));
    }
    let targets = r[request::TARGET_COUNT] as usize;
    if targets != 0 {
        let table = core::slice::from_raw_parts(r[request::TARGETS] as *const u32, targets * 2);
        for target in table.chunks(2) {
            deformation.targets.push(MorphTarget {
                position: floats(target[0], vertices * 3).to_vec(),
                normal: (target[1] != 0).then(|| floats(target[1], vertices * 3).to_vec()),
            });
        }
    }
    let exponents = (
        r[request::POSITION_EXPONENT] as i32,
        r[request::UV_EXPONENT] as i32,
    );
    match encode_deformed(indices, positions, &carried, (&deformation, &[]), exponents) {
        Ok(page) => {
            answer[meta::VERTEX_COUNT] = page.header.vertex_count as u32;
            answer[meta::INDEX_COUNT] = page.header.index_count as u32;
            answer[meta::FLAGS] = page.header.flags;
            answer[meta::DECODED_BYTES] = page.header.decoded_bytes() as u32;
            answer[meta::QUANTIZATION_ERROR] = page.header.quantization_error.to_bits();
            answer[meta::BYTES] = page.bytes.len() as u32;
            PAGE.with(|held| *held.borrow_mut() = page.bytes);
            0
        }
        Err(refusal) => refuse(meta, &refusal.code),
    }
}

/// Writes a refusal's `code` in the answer block at `meta`: its length in word 0, its ASCII bytes
/// from byte 4. Returns 1, the status of a refusal.
///
/// # Safety
/// `meta` must lie in a live `arena_alloc` reservation of `META_WORDS` words.
pub(crate) unsafe fn refuse(meta: u32, code: &str) -> u32 {
    let code = code.as_bytes();
    assert!(code.len() <= (META_WORDS - 1) * 4);
    *(meta as *mut u32) = code.len() as u32;
    core::slice::from_raw_parts_mut((meta + 4) as *mut u8, code.len()).copy_from_slice(code);
    1
}

/// Copies the page `encode_page` wrote into `out` and forgets it.
///
/// # Safety
/// `out` must lie in a live `arena_alloc` reservation of at least the page's byte length.
#[no_mangle]
pub unsafe extern "C" fn encode_page_take(out: u32) {
    PAGE.with(|held| {
        let page = held.take();
        core::slice::from_raw_parts_mut(out as *mut u8, page.len()).copy_from_slice(&page);
    });
}

/// A tile's width as a power of two for a primitive the largest world `scale` places
/// (`tile_log2`); NaN where the compiler knew none.
#[no_mangle]
pub extern "C" fn grid_tile_log2(scale: f64) -> i32 {
    tile_log2((!scale.is_nan()).then_some(scale))
}

/// The position grid of a primitive of widest `extent` (`primitive_grid_exponent`): `finest_error`
/// is NaN where the compiler knew none, `blended` 0 or 1, `tile_log2` from `grid_tile_log2`.
#[no_mangle]
pub extern "C" fn grid_position_exponent(
    extent: f64,
    finest_error: f64,
    blended: u32,
    tile_log2: i32,
) -> i32 {
    let known = (!finest_error.is_nan()).then_some(finest_error);
    primitive_grid_exponent(extent, known, blended != 0, tile_log2)
}

/// The texture grid of a compiled primitive whose coordinates span `span` (`uv_grid_exponent`).
#[no_mangle]
pub extern "C" fn grid_uv_exponent(span: f64, blended: u32) -> i32 {
    uv_grid_exponent(span, blended != 0)
}

/// The texture grid of drawn triangles (`drawn_uv_grid_exponent`).
#[no_mangle]
pub extern "C" fn grid_drawn_uv_exponent(span: f64, blended: u32) -> i32 {
    drawn_uv_grid_exponent(span, blended != 0)
}
