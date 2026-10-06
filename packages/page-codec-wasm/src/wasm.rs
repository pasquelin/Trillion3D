//! Raw WebAssembly ABI: no `wasm-bindgen`, only integers and offsets in linear memory. The
//! JavaScript loader writes the page at the offset returned by `page_alloc`, calls `page_decode`,
//! reads the result block, then releases it with `page_release`.

use crate::unpack::decode_into;
use crate::{Header, PageError};

/// Result block, in 32-bit words: 0 status (0 = decoded), 1 vertices, 2 indices, 3 flags,
/// 4 decoded bytes, 5 quantization error as its `f32` bits, then the decoded page itself —
/// `decoded bytes / 4` words: the indices, the position, each present attribute in stream order.
const RESULT_WORDS: usize = 6;

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

/// Reserves `len` bytes for the packed page, on a word boundary so the decoder reads the
/// streams in place. Returns 0 if the size is absurd.
#[no_mangle]
pub extern "C" fn page_alloc(len: usize) -> u32 {
    if len == 0 || len > 1 << 30 {
        return 0;
    }
    fuite(vec![0u32; len.div_ceil(4)])
}

/// Releases a `page_alloc` reservation.
///
/// # Safety
/// `offset` must come from `page_alloc` with this same `len`, and must not already have been released.
#[no_mangle]
pub unsafe extern "C" fn page_free(offset: u32, len: usize) {
    rends::<u32>(offset, len.div_ceil(4));
}

/// Decodes the page written at `offset` and returns the result-block offset, or 0 if memory is short.
///
/// # Safety
/// `offset` and `len` must describe a live `page_alloc` reservation.
#[no_mangle]
pub unsafe extern "C" fn page_decode(offset: u32, len: usize, max_decoded_bytes: usize) -> u32 {
    let data = core::slice::from_raw_parts(offset as *const u8, len);
    fuite(
        result_block(data, max_decoded_bytes).unwrap_or_else(|cause| {
            let mut bloc = vec![0; RESULT_WORDS];
            bloc[0] = cause as u32;
            bloc
        }),
    )
}

/// The result block of a decoded page, sized from its accepted header and the page decoded
/// straight into it (STR-02): no intermediate vector, no copy of the decoded words.
fn result_block(data: &[u8], max_decoded_bytes: usize) -> Result<Vec<u32>, PageError> {
    let header = Header::parse(data, max_decoded_bytes)?;
    let mut bloc = vec![0u32; RESULT_WORDS + header.decoded_bytes() / 4];
    let (meta, page) = bloc.split_at_mut(RESULT_WORDS);
    decode_into(data, &header, page)?;
    meta.copy_from_slice(&[
        0,
        header.vertex_count as u32,
        header.index_count as u32,
        header.flags,
        header.decoded_bytes() as u32,
        header.quantization_error.to_bits(),
    ]);
    Ok(bloc)
}

/// Releases the result block, page included.
///
/// # Safety
/// `offset` must come from `page_decode` and must not already have been released.
#[no_mangle]
pub unsafe extern "C" fn page_release(offset: u32) {
    if offset == 0 {
        return;
    }
    let bloc = core::slice::from_raw_parts(offset as *const u32, RESULT_WORDS);
    rends::<u32>(offset, RESULT_WORDS + bloc[4] as usize / 4);
}
