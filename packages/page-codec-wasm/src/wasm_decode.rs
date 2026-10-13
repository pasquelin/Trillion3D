//! Raw ABI of the page decoder (`unpack.rs`): byte offsets into `arena_alloc` reservations, like
//! `wasm_encode.rs`, whose answer it shares — a page's header on success (`meta`,
//! `answer_header`), a refusal's code otherwise (`refuse`). The loader is
//! `packages/sdk-browser/src/page/codec/geometryPage.ts`, the one decoder of the SDK: the header's
//! gate (`page_check`) admits a page the pool uploads as it is, the unpack (`page_unpack`) writes
//! its indices and attributes into a block the loader reserved.

use crate::unpack::decode_into;
use crate::wasm_encode::{answer_header, refuse};
use crate::Header;

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
            answer_header(answer, &header);
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
