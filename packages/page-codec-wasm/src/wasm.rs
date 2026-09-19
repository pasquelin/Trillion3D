//! Raw WebAssembly ABI: no `wasm-bindgen`, only integers and offsets in linear memory. The
//! JavaScript loader writes the page at the offset returned by `page_alloc`, calls `page_decode`,
//! reads the result block, then releases everything with `page_release`.

use crate::{decode, OPTIONAL};

/// Result block, in 32-bit words:
/// 0 status (0 = decoded), 1 vertices, 2 indices, 3 flags, 4 decompressed bytes,
/// 5 index offset, 6 position offset, 7 to 11 optional-attribute offsets (0 = absent).
const RESULT_WORDS: usize = 12;

pub(crate) fn fuite<T>(valeurs: Vec<T>) -> u32 {
    let boite = valeurs.into_boxed_slice();
    Box::into_raw(boite) as *mut T as u32
}

/// Releases an allocation made by `fuite`: a sliced box's capacity equals its length.
pub(crate) unsafe fn rends<T>(offset: u32, len: usize) {
    if offset != 0 {
        drop(Vec::from_raw_parts(offset as *mut T, len, len));
    }
}

/// Reserves `len` bytes for the compressed page. Returns 0 if the size is absurd.
#[no_mangle]
pub extern "C" fn page_alloc(len: usize) -> u32 {
    if len == 0 || len > 1 << 30 {
        return 0;
    }
    fuite(vec![0u8; len])
}

/// Releases a `page_alloc` reservation.
///
/// # Safety
/// `offset` must come from `page_alloc` with this same `len`, and must not already have been released.
#[no_mangle]
pub unsafe extern "C" fn page_free(offset: u32, len: usize) {
    rends::<u8>(offset, len);
}

/// Decodes the page written at `offset` and returns the result-block offset, or 0 if memory is short.
///
/// # Safety
/// `offset` and `len` must describe a live `page_alloc` reservation.
#[no_mangle]
pub unsafe extern "C" fn page_decode(offset: u32, len: usize, max_decoded_bytes: usize) -> u32 {
    let data = core::slice::from_raw_parts(offset as *const u8, len);
    let mut bloc = vec![0u32; RESULT_WORDS];
    match decode(data, max_decoded_bytes) {
        Err(cause) => bloc[0] = cause as u32,
        Ok(page) => {
            bloc[1] = page.vertex_count as u32;
            bloc[2] = page.indices.len() as u32;
            bloc[3] = page.flags;
            bloc[4] = page.decoded_bytes as u32;
            bloc[5] = fuite(page.indices);
            bloc[6] = fuite(page.position);
            for (rang, valeurs) in page.optional.into_iter().enumerate() {
                bloc[7 + rang] = valeurs.map_or(0, fuite);
            }
        }
    }
    fuite(bloc)
}

/// Releases the result block and every buffer it names.
///
/// # Safety
/// `offset` must come from `page_decode` and must not already have been released.
#[no_mangle]
pub unsafe extern "C" fn page_release(offset: u32) {
    if offset == 0 {
        return;
    }
    let bloc = core::slice::from_raw_parts(offset as *const u32, RESULT_WORDS);
    let vertex_count = bloc[1] as usize;
    rends::<u32>(bloc[5], bloc[2] as usize);
    rends::<f32>(bloc[6], vertex_count * 3);
    for (rang, &(_, size)) in OPTIONAL.iter().enumerate() {
        rends::<f32>(bloc[7 + rang], vertex_count * size);
    }
    rends::<u32>(offset, RESULT_WORDS);
}
