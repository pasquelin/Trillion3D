//! Raw ABI of the page decoder (`unpack.rs`): byte offsets into `arena_alloc` reservations, like
//! `wasm_encode.rs`, whose refusal answer it shares. The loader is
//! `packages/sdk-browser/src/page/codec/geometryPage.ts`, the one decoder of the SDK: the header's
//! gate (`page_check`) admits a page the pool uploads as it is, the unpack (`page_unpack`) writes
//! its indices and attributes into a block the loader reserved.

use crate::unpack::decode_into;
use crate::wasm_encode::{refuse, META_WORDS};
use crate::Header;

/// The words `page_check` answers in on success, after the refusal answer of `wasm_encode.rs`
/// (word 0 the length of the code, its ASCII bytes from byte 4) on a refusal: the page's
/// vertices, indices, flags, decoded bytes, quantization error (float bits), morph targets and
/// skin influences.
pub mod unpacked {
    pub const VERTEX_COUNT: usize = 0;
    pub const INDEX_COUNT: usize = 1;
    pub const FLAGS: usize = 2;
    pub const DECODED_BYTES: usize = 3;
    pub const QUANTIZATION_ERROR: usize = 4;
    pub const MORPH_TARGETS: usize = 5;
    pub const SKIN_INFLUENCES: usize = 6;
}

unsafe fn page<'a>(data: u32, length: u32) -> &'a [u8] {
    core::slice::from_raw_parts(data as *const u8, length as usize)
}

/// Reads the page's header and gates it: magic, version, grids, and counts that measure exactly
/// `length` bytes under `max_decoded_bytes`. Returns 0 and fills `answer`, or 1 with the
/// refusal's code in `answer`.
///
/// # Safety
/// `data` must lie in a live `arena_alloc` reservation of `length` bytes and `answer` in one of
/// `META_WORDS` words.
#[no_mangle]
pub unsafe extern "C" fn page_check(
    data: u32,
    length: u32,
    max_decoded_bytes: u32,
    answer: u32,
) -> u32 {
    match Header::parse(page(data, length), max_decoded_bytes as usize) {
        Ok(header) => {
            let words = core::slice::from_raw_parts_mut(answer as *mut u32, META_WORDS);
            words[unpacked::VERTEX_COUNT] = header.vertex_count as u32;
            words[unpacked::INDEX_COUNT] = header.index_count as u32;
            words[unpacked::FLAGS] = header.flags;
            words[unpacked::DECODED_BYTES] = header.decoded_bytes() as u32;
            words[unpacked::QUANTIZATION_ERROR] = header.quantization_error.to_bits();
            words[unpacked::MORPH_TARGETS] = header.morphs.len() as u32;
            words[unpacked::SKIN_INFLUENCES] = header.skin.influences as u32;
            0
        }
        Err(refusal) => refuse(answer, refusal.code()),
    }
}

/// Unpacks the page into `out`, `DECODED_BYTES` of its `page_check`: the indices, then each
/// attribute's floats in stream order. Returns 0, or 1 with the refusal's code in `answer`.
///
/// # Safety
/// As `page_check`, and `out` must lie in a live reservation of the `decoded_bytes` the check
/// answered for this page.
#[no_mangle]
pub unsafe extern "C" fn page_unpack(
    data: u32,
    length: u32,
    max_decoded_bytes: u32,
    answer: u32,
    out: u32,
) -> u32 {
    let bytes = page(data, length);
    let header = match Header::parse(bytes, max_decoded_bytes as usize) {
        Ok(header) => header,
        Err(refusal) => return refuse(answer, refusal.code()),
    };
    let out = core::slice::from_raw_parts_mut(out as *mut u32, header.decoded_bytes() / 4);
    match decode_into(bytes, &header, out) {
        Ok(()) => 0,
        Err(refusal) => refuse(answer, refusal.code()),
    }
}
