//! A page's streams unpacked into one block of words — the mirror of `decodeGeometryPage` —, each
//! stream walked once by a `BitReader` (STR-01, #238): the same bits as develop's decoder, which
//! reads every field at random (`unpack_reference.rs`), as the equivalence harness proves.

use crate::bits::{dequant, le_words, oct_decode, BitReader, Quant};
use crate::deform::{decode_morphs, decode_skin};
use crate::{DecodedPage, Header, Layout, PageError};
use crate::{FLAG_COLOR, FLAG_MORPH, FLAG_NORMAL, FLAG_SKIN, FLAG_UV, FLAG_UV1};

/// A complete page, its streams unpacked and dequantized: the same bytes as `decodeGeometryPage`.
pub fn decode(data: &[u8], max_decoded_bytes: usize) -> Result<DecodedPage, PageError> {
    let header = Header::parse(data, max_decoded_bytes)?;
    let mut words = vec![0u32; header.decoded_bytes() / 4];
    decode_into(data, &header, &mut words)?;
    Ok(DecodedPage {
        words,
        vertex_count: header.vertex_count,
        index_count: header.index_count,
        flags: header.flags,
        morph_targets: header.morphs.len(),
        quantization_error: header.quantization_error,
    })
}

/// `decode` into `out`, exactly `decoded_bytes / 4` words, `header` being what `Header::parse`
/// accepted for `data` (STR-02): the WebAssembly ABI decodes straight into its result block, with
/// no second buffer nor copy. The streams are read in place when the page sits on a word
/// boundary — a `page_alloc` reservation always does — and from a copy otherwise.
pub(crate) fn decode_into(data: &[u8], header: &Header, out: &mut [u32]) -> Result<(), PageError> {
    let body = &data[header.bytes()..];
    // SAFETY: every bit pattern is a valid `u32`; the byte count is a multiple of four, so an
    // empty head leaves no tail. Only a little-endian host may read the words as they lie.
    let (head, aligned, _) = unsafe { body.align_to::<u32>() };
    if cfg!(target_endian = "little") && head.is_empty() {
        split(aligned, header, out)
    } else {
        split(&le_words(body).collect::<Vec<_>>(), header, out)
    }
}

/// One dequantized vector attribute into `out`: component `c` of vertex `i` is field `i` of
/// stream `c`. A component of zero width reads its minimum for every vertex.
/// The header's bounds keep every value finite: a 24-bit field on the coarsest grid adds at
/// most 2^88 to a finite minimum, which rounds back into the float's range.
#[inline(always)]
fn vector<const N: usize>(out: &mut [u32], words: &[u32], starts: [usize; N], record: &Quant<N>) {
    let step = record.step();
    let vertices = out.as_chunks_mut::<N>().0;
    for c in 0..N {
        let (min, bits) = (record.min[c], record.bits[c]);
        let mut stream = BitReader::at(words, starts[c] * 32);
        for vertex in vertices.iter_mut() {
            vertex[c] = dequant(min, stream.read(bits), step).to_bits();
        }
    }
}

/// Indices first, all checked before a single float is written, then the attributes in stream order.
fn split(words: &[u32], h: &Header, out: &mut [u32]) -> Result<(), PageError> {
    debug_assert_eq!(out.len(), h.decoded_bytes() / 4);
    let layout = Layout::of(h);
    let n = h.vertex_count;
    let (indices, mut rest) = out.split_at_mut(h.index_count);
    layout.corners.read(words, layout.triangles, n, indices)?;
    let mut take = |width: usize| {
        let (head, tail) = core::mem::take(&mut rest).split_at_mut(n * width);
        rest = tail;
        head
    };
    vector(take(3), words, layout.position, &h.position);
    if h.flags & FLAG_NORMAL != 0 {
        let mut stream = BitReader::at(words, layout.normal * 32);
        for normal in take(3).as_chunks_mut::<3>().0 {
            *normal = oct_decode(stream.read(16)).map(f32::to_bits);
        }
    }
    if h.flags & FLAG_UV != 0 {
        vector(take(2), words, layout.uv, &h.uv);
    }
    if h.flags & FLAG_UV1 != 0 {
        vector(take(2), words, layout.uv1, &h.uv1);
    }
    if h.flags & FLAG_COLOR != 0 {
        vector(take(4), words, layout.color, &h.color);
    }
    if h.flags & FLAG_SKIN != 0 {
        decode_skin(words, layout.skin, &h.skin, take(8));
    }
    if h.flags & FLAG_MORPH != 0 {
        decode_morphs(words, &h.morphs, take(6 * h.morphs.len()));
    }
    Ok(())
}

#[cfg(test)]
#[path = "unpack_reference.rs"]
mod reference;
#[cfg(test)]
#[path = "unpack_tests.rs"]
mod tests;
