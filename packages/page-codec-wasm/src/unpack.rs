//! A page's streams unpacked into one block of words — the one decoder, which `decodeGeometryPage` calls through `wasm/decode.rs` —, each
//! stream walked once by a `BitReader` (STR-01): the same bits as the reference decoder, which
//! reads every field at random (`unpack/reference.rs`, a test oracle of another algorithm, never
//! shipped), as the equivalence harness proves.

use crate::attributes::UV_FLAGS;
use crate::bits::{
    color_value, le_words, normal_decode_stream, tangent_decode_stream, uv_value, BitReader,
};
use crate::deform::{decode_morphs, decode_skin};
use crate::{DecodedPage, Header, Layout, PageError};
use crate::{FLAG_COLOR, FLAG_MORPH, FLAG_NORMAL, FLAG_SKIN, FLAG_TANGENT};

/// A complete page, its streams unpacked and dequantized: the block `decodeGeometryPage` lays its views on.
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
        skin_influences: header.skin.influences,
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

/// One attribute of `N` floats a vertex into `out`: component `c` of vertex `i` is
/// `value(c, field)`, `field` being field `i` of stream `c`, `bits[c]` wide from word `starts[c]`.
/// A component of zero width reads zero for every vertex, which `value` makes its range's least.
#[inline(always)]
fn decode_vectors<const N: usize>(
    out: &mut [u32],
    words: &[u32],
    (starts, bits): ([usize; N], [u32; N]),
    value: impl Fn(usize, u32) -> f32,
) {
    let vertices = out.as_chunks_mut::<N>().0;
    for c in 0..N {
        let mut stream = BitReader::at(words, starts[c] * 32);
        for vertex in vertices.iter_mut() {
            vertex[c] = value(c, stream.read(bits[c])).to_bits();
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
    let positions = take(3);
    if h.links_positions() {
        crate::positions::linked(positions, words, &layout, h);
    } else {
        let (grid, unit) = (&h.position, h.position.unit());
        let streams = (layout.position, grid.bits);
        decode_vectors(positions, words, streams, |c, offset| {
            grid.metres(c, offset, unit)
        });
    }
    let mut normals: &mut [u32] = &mut [];
    if h.flags & FLAG_NORMAL != 0 {
        normals = take(3);
        normal_decode_stream(words, layout.normal, h.normal_precision, normals);
    }
    for (set, flag) in UV_FLAGS.into_iter().enumerate() {
        if h.flags & flag != 0 {
            let range = &h.uv[set];
            let streams = (layout.uv[set], range.bits);
            decode_vectors(take(2), words, streams, |c, code| {
                uv_value(range.min[c] + code)
            });
        }
    }
    if h.flags & FLAG_COLOR != 0 {
        let range = &h.color;
        let streams = (layout.color, range.bits);
        decode_vectors(take(4), words, streams, |c, byte| {
            color_value(range.min[c] + byte)
        });
    }
    // Each stored tangent turns around its vertex's normal as decoded above (`Header::parse` keeps
    // a page with tangents and no normals out).
    if h.flags & FLAG_TANGENT != 0 {
        let stream = &words[layout.tangent..];
        tangent_decode_stream(stream, h.tangent_precision, normals, take(4));
    }
    if h.flags & FLAG_SKIN != 0 {
        decode_skin(words, layout.skin, &h.skin, take(2 * h.skin.influences));
    }
    if h.flags & FLAG_MORPH != 0 {
        decode_morphs(words, &h.morphs, take(6 * h.morphs.len()));
    }
    Ok(())
}

#[cfg(test)]
mod reference;
#[cfg(test)]
mod tests;
