//! Raw ABI of the page encoder (`../encode.rs`) for the pages the engine cuts at run time (their grids
//! come from `grid.rs`): byte offsets into `arena_alloc` reservations, like `math.rs`. The loader is `packages/sdk-browser/src/page/codec/encode.ts`.
//!
//! A page is written by `encode_page` from one request block of `REQUEST_WORDS` words and held for
//! the loader (`held.rs`): its length is known only once written.

use crate::encode::deformation::{Deformation, MorphTarget};
use crate::encode::{encode_deformed, Attribute};
use crate::wasm::held::hold;
use crate::wasm::math::{view, view_mut};
use crate::{Header, FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};

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

/// Words of the block `encode_page` and the decoder's `page_check` (`decode.rs`) answer in.
pub const META_WORDS: usize = 16;
/// The answer's words on success, the header of the page written or checked (`answer_header`):
/// its `vertex_count`, `index_count`, `flags`, decoded bytes, quantization error (float bits),
/// morph targets and skin influences; `encode_page` adds the page's normal cone (`Encoded::cone`),
/// `[x, y, z, angle]` as four float64, low word first, from `CONE`. On refusal, word 0 is the length of the refusal's code and
/// its ASCII bytes follow from byte 4 (`refuse`).
pub mod meta {
    pub const VERTEX_COUNT: usize = 0;
    pub const INDEX_COUNT: usize = 1;
    pub const FLAGS: usize = 2;
    pub const DECODED_BYTES: usize = 3;
    pub const QUANTIZATION_ERROR: usize = 4;
    pub const MORPH_TARGETS: usize = 5;
    pub const SKIN_INFLUENCES: usize = 6;
    pub const CONE: usize = 7;
}

/// Writes the page `request` describes. Returns 0, its header answered in `meta` and the page held;
/// or 1 with the refusal's code in `meta`.
///
/// # Safety
/// `request` and `meta` must lie in live `arena_alloc` reservations of `REQUEST_WORDS` and
/// `META_WORDS` words, and every offset the request names in one holding the counts it states.
#[no_mangle]
pub unsafe extern "C" fn encode_page(request: u32, meta: u32) -> u32 {
    let r: &[u32] = view(request, REQUEST_WORDS);
    let vertices = r[request::VERTEX_COUNT] as usize;
    let indices = view(r[request::INDICES], r[request::INDEX_COUNT] as usize);
    let positions = view::<f32>(r[request::POSITIONS], vertices * 3);
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
                values: view::<f32>(r[word], vertices * width).to_vec(),
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
            view::<u32>(r[request::JOINTS], count).to_vec(),
            view::<f32>(r[request::WEIGHTS], count).to_vec(),
        ));
    }
    let targets = r[request::TARGET_COUNT] as usize;
    if targets != 0 {
        let table: &[u32] = view(r[request::TARGETS], targets * 2);
        for target in table.chunks(2) {
            deformation.targets.push(MorphTarget {
                position: view::<f32>(target[0], vertices * 3).to_vec(),
                normal: (target[1] != 0).then(|| view::<f32>(target[1], vertices * 3).to_vec()),
            });
        }
    }
    let exponents = (
        r[request::POSITION_EXPONENT] as i32,
        r[request::UV_EXPONENT] as i32,
    );
    match encode_deformed(indices, positions, &carried, (&deformation, &[]), exponents) {
        Ok(page) => {
            answer_header(meta, &page.header);
            let words = view_mut::<u32>(meta, META_WORDS);
            for (at, value) in page.cone.iter().enumerate() {
                let bits = value.to_bits();
                words[meta::CONE + at * 2] = bits as u32;
                words[meta::CONE + at * 2 + 1] = (bits >> 32) as u32;
            }
            hold(page.bytes);
            0
        }
        Err(refusal) => refuse(meta, &refusal.code),
    }
}

/// Answers `header` in the block at `answer`, word by word of `meta`.
///
/// # Safety
/// `answer` must lie in a live `arena_alloc` reservation of `META_WORDS` words.
pub(crate) unsafe fn answer_header(answer: u32, header: &Header) {
    let words = view_mut::<u32>(answer, META_WORDS);
    words[meta::VERTEX_COUNT] = header.vertex_count as u32;
    words[meta::INDEX_COUNT] = header.index_count as u32;
    words[meta::FLAGS] = header.flags;
    words[meta::DECODED_BYTES] = header.decoded_bytes() as u32;
    words[meta::QUANTIZATION_ERROR] = header.quantization_error.to_bits();
    words[meta::MORPH_TARGETS] = header.morphs.len() as u32;
    words[meta::SKIN_INFLUENCES] = header.skin.influences as u32;
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
    view_mut(meta + 4, code.len()).copy_from_slice(code);
    1
}
