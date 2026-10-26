//! Raw ABI of the page decoder (`../unpack.rs`): byte offsets into `arena_alloc` reservations, like
//! `encode.rs`, whose answer it shares — a page's header on success (`meta`,
//! `answer_header`), a refusal's code otherwise (`refuse`). The loader is
//! `packages/sdk-browser/src/geometry/codec/geometryPage.ts`, the one decoder of the SDK: the header's
//! gate (`page_check`) admits a page the install pass transcodes, the unpack (`page_unpack`) writes
//! its indices and attributes into a block the loader reserved, and `page_resident` writes the
//! resident page the install pass writes into the pool, held for the loader. A page that names
//! vertices of other clusters is unpacked and made resident where the pool holds them, as the
//! install pass finds them: a block of `POOL_WORDS` words, the byte offset and length of the
//! pool's bytes, then the byte offset and count of the words that start its own streaming page and
//! each page of its list of dependencies in the pool (`NO_UNIT` for one not resident); 0 for a
//! page that names none.

use crate::unpack::decode_into;
use crate::wasm::encode::{answer_header, refuse, POOL_WORDS};
use crate::wasm::held::hold;
use crate::wasm::math::{view, view_mut, view_or_empty};
use crate::{disk, resident, Header};

/// Where a page finds the clusters it names: the pool's bytes and the starts of its streaming
/// pages, as the block at `block` says, none for a block of 0.
///
/// # Safety
/// `block` must be 0 or lie in a live `arena_alloc` reservation of `POOL_WORDS` words, naming
/// reservations of the lengths it states.
unsafe fn pool_of<'a>(block: u32) -> (&'a [u8], &'a [u32]) {
    if block == 0 {
        return (&[], &[]);
    }
    let [pool, length, units, count]: [u32; POOL_WORDS] = view::<u32>(block, POOL_WORDS)
        .try_into()
        .unwrap_or_default();
    (
        view_or_empty(pool, length as usize),
        view_or_empty(units, count as usize),
    )
}

/// Reads the page's header and gates it: magic, version, grids, and counts that measure exactly
/// `length` bytes under `max_decoded_bytes`, every field read back. Returns 0 and fills `answer`,
/// or 1 with the refusal's code in `answer`.
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
    match Header::parse(view(data, length as usize), max_decoded_bytes as usize) {
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
/// As `page_check`, `out` must lie in a live reservation of the `decoded_bytes` the check
/// answered for this page, and the pool block as `pool_of` says.
#[no_mangle]
pub unsafe extern "C" fn page_unpack(
    data: u32,
    length: u32,
    max_decoded_bytes: u32,
    answer: u32,
    out: u32,
    pool: u32,
) -> u32 {
    let held = pool_of(pool);
    let page = match disk::read_in(
        view(data, length as usize),
        max_decoded_bytes as usize,
        held,
    ) {
        Ok(page) => page,
        Err(refusal) => return refuse(answer, refusal.code()),
    };
    let resident = resident::write(&page.header, &page.streams);
    let out = view_mut(out, page.header.decoded_bytes() / 4);
    match decode_into(&resident, &page.header, out) {
        Ok(()) => 0,
        Err(refusal) => refuse(answer, refusal.code()),
    }
}

/// Writes the resident page of the page on disk — the bytes the install pass writes into the
/// pool — and holds it for the loader (`held.rs`). Returns 0, or 1 with the refusal's code in
/// `answer`.
///
/// # Safety
/// As `page_check`, and the pool block as `pool_of` says.
#[no_mangle]
pub unsafe extern "C" fn page_resident(
    data: u32,
    length: u32,
    max_decoded_bytes: u32,
    answer: u32,
    pool: u32,
) -> u32 {
    let held = pool_of(pool);
    match resident::expand_in(
        view(data, length as usize),
        max_decoded_bytes as usize,
        held,
    ) {
        Ok(bytes) => {
            hold(bytes);
            0
        }
        Err(refusal) => refuse(answer, refusal.code()),
    }
}
