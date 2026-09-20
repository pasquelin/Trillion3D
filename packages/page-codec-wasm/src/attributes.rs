//! Streams of a page and their unpacking into float buffers: the mirror of `decodePageAttributes`.

use crate::bits::{bits_for, dequant, field, oct_decode, stream_words, Quant};
use crate::{Header, PageError, FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1, HEADER_BYTES};

/// Presence bit and float width of each optional attribute, in stream order: normal, uv, uv1,
/// colour. Position occupies the first three floats of a decoded vertex.
pub const OPTIONAL: [(u32, usize); 4] = [
    (FLAG_NORMAL, 3),
    (FLAG_UV, 2),
    (FLAG_UV1, 2),
    (FLAG_COLOR, 4),
];

/// Buffers of a page: 32-bit indices, position, then the optional attributes present at their
/// rank in `OPTIONAL`.
pub struct DecodedPage {
    pub indices: Vec<u32>,
    pub position: Vec<f32>,
    pub optional: [Option<Vec<f32>>; 4],
    pub vertex_count: usize,
    pub flags: u32,
    pub decoded_bytes: usize,
}

/// A decoded page is summarised by its counts: printing its buffers would teach nothing.
impl core::fmt::Debug for DecodedPage {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            f,
            "DecodedPage {{ vertices: {}, indices: {}, flags: {} }}",
            self.vertex_count,
            self.indices.len(),
            self.flags
        )
    }
}

/// Word offset, after the header, of each bit stream — every one derived from the counts and
/// the widths, so the header stores no offset and a reader trusts none.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Layout {
    pub index_bits: u32,
    pub indices: usize,
    pub position: [usize; 3],
    pub normal: usize,
    pub uv: [usize; 2],
    pub uv1: [usize; 2],
    pub color: [usize; 4],
    /// Words of every stream together.
    pub words: usize,
}

impl Layout {
    pub fn of(h: &Header) -> Self {
        let index_bits = bits_for(h.vertex_count.saturating_sub(1) as u64);
        let mut at = 0usize;
        let mut stream = |present: bool, count: usize, bits: u32| {
            let start = at;
            if present {
                at += stream_words(count, bits);
            }
            start
        };
        let indices = stream(true, h.index_count, index_bits);
        let position = h.position.bits.map(|b| stream(true, h.vertex_count, b));
        let normal = stream(h.flags & FLAG_NORMAL != 0, h.vertex_count, 16);
        let uv = h.uv.bits.map(|b| stream(h.flags & FLAG_UV != 0, h.vertex_count, b));
        let uv1 = h.uv1.bits.map(|b| stream(h.flags & FLAG_UV1 != 0, h.vertex_count, b));
        let color = h.color.bits.map(|b| stream(h.flags & FLAG_COLOR != 0, h.vertex_count, b));
        Self {
            index_bits,
            indices,
            position,
            normal,
            uv,
            uv1,
            color,
            words: at,
        }
    }

    /// Length of the whole page file: the header and every stream.
    pub fn bytes(&self) -> usize {
        HEADER_BYTES + self.words * 4
    }
}

/// One dequantized vector attribute: component `c` of vertex `i` sits at bit `i * bits[c]` of
/// stream `c`. A component of zero width reads its minimum for every vertex. The header's bounds
/// keep every value finite: a 24-bit field on the coarsest grid adds at most 2^88 to a finite
/// minimum, which rounds back into the float's range.
fn vector<const N: usize>(
    words: &[u32],
    starts: [usize; N],
    record: &Quant<N>,
    vertex_count: usize,
) -> Vec<f32> {
    let step = record.step();
    let mut out = vec![0f32; vertex_count * N];
    for c in 0..N {
        let bits = record.bits[c];
        let base = starts[c] * 32;
        for i in 0..vertex_count {
            let q = field(words, base + i * bits as usize, bits);
            out[i * N + c] = dequant(record.min[c], q, step);
        }
    }
    out
}

/// Indices first, all checked before a single float is read, then the attributes in stream order.
pub fn split(words: &[u32], h: &Header) -> Result<DecodedPage, PageError> {
    let layout = Layout::of(h);
    let index_base = layout.indices * 32;
    let bits = layout.index_bits;
    let indices: Vec<u32> = (0..h.index_count)
        .map(|i| field(words, index_base + i * bits as usize, bits))
        .collect();
    if indices.iter().any(|&index| index as usize >= h.vertex_count) {
        return Err(PageError::Index);
    }
    let n = h.vertex_count;
    let position = vector(words, layout.position, &h.position, n);
    let mut optional: [Option<Vec<f32>>; 4] = [None, None, None, None];
    if h.flags & FLAG_NORMAL != 0 {
        let base = layout.normal * 32;
        optional[0] = Some(
            (0..n)
                .flat_map(|i| oct_decode(field(words, base + i * 16, 16)))
                .collect(),
        );
    }
    if h.flags & FLAG_UV != 0 {
        optional[1] = Some(vector(words, layout.uv, &h.uv, n));
    }
    if h.flags & FLAG_UV1 != 0 {
        optional[2] = Some(vector(words, layout.uv1, &h.uv1, n));
    }
    if h.flags & FLAG_COLOR != 0 {
        optional[3] = Some(vector(words, layout.color, &h.color, n));
    }
    Ok(DecodedPage {
        indices,
        position,
        optional,
        vertex_count: n,
        flags: h.flags,
        decoded_bytes: h.decoded_bytes(),
    })
}
