//! Streams of a page and their unpacking into one block of words: the mirror of `decodeGeometryPage`.

use crate::bits::{bits_for, dequant, field, oct_decode, stream_words, Quant};
use crate::{Header, PageError, FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1, HEADER_BYTES};

/// Presence bit and float width of each optional attribute, in stream order: normal, uv, uv1,
/// colour. Position, three floats wide, precedes them in a decoded page.
pub const OPTIONAL: [(u32, usize); 4] = [
    (FLAG_NORMAL, 3),
    (FLAG_UV, 2),
    (FLAG_UV1, 2),
    (FLAG_COLOR, 4),
];

/// A decoded page as one block of words — the 32-bit indices, then the floats of the position
/// and of each present attribute in stream order, as their bits —, exactly `decoded_bytes`
/// long. The block crosses the WebAssembly boundary whole; the JavaScript decoder yields the
/// same bytes as views on one buffer.
pub struct DecodedPage {
    pub words: Vec<u32>,
    pub vertex_count: usize,
    pub index_count: usize,
    pub flags: u32,
    /// The header's largest position displacement, in object units.
    pub quantization_error: f32,
}

impl DecodedPage {
    pub fn indices(&self) -> &[u32] {
        &self.words[..self.index_count]
    }

    /// Floats of the attribute at `rank` — 0 the position, then `OPTIONAL`'s order —, or
    /// `None` when the page does not carry it.
    pub fn attribute(&self, rank: usize) -> Option<&[f32]> {
        let mut at = self.index_count;
        for (r, (bit, width)) in core::iter::once((0, 3)).chain(OPTIONAL).enumerate() {
            if self.flags & bit != bit {
                continue;
            }
            let run = at..at + self.vertex_count * width;
            if r == rank {
                return Some(floats(&self.words[run]));
            }
            at = run.end;
        }
        None
    }

    pub fn decoded_bytes(&self) -> usize {
        self.words.len() * 4
    }
}

/// The floats a run of words spells, without a copy.
fn floats(words: &[u32]) -> &[f32] {
    // SAFETY: `f32` and `u32` share size and alignment, and every bit pattern is a valid `f32`.
    unsafe { core::slice::from_raw_parts(words.as_ptr().cast::<f32>(), words.len()) }
}

/// A decoded page is summarised by its counts: printing its buffers would teach nothing.
impl core::fmt::Debug for DecodedPage {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            f,
            "DecodedPage {{ vertices: {}, indices: {}, flags: {} }}",
            self.vertex_count, self.index_count, self.flags
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
        let index_bits = bits_for(h.vertex_count.saturating_sub(1) as u32);
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
        let uv =
            h.uv.bits
                .map(|b| stream(h.flags & FLAG_UV != 0, h.vertex_count, b));
        let uv1 = h
            .uv1
            .bits
            .map(|b| stream(h.flags & FLAG_UV1 != 0, h.vertex_count, b));
        let color = h
            .color
            .bits
            .map(|b| stream(h.flags & FLAG_COLOR != 0, h.vertex_count, b));
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
        HEADER_BYTES.saturating_add(self.words.saturating_mul(4))
    }
}

/// One dequantized vector attribute into `out`: component `c` of vertex `i` sits at bit
/// `i * bits[c]` of stream `c`. A component of zero width reads its minimum for every vertex.
/// The header's bounds keep every value finite: a 24-bit field on the coarsest grid adds at
/// most 2^88 to a finite minimum, which rounds back into the float's range.
fn vector<const N: usize>(out: &mut [u32], words: &[u32], starts: [usize; N], record: &Quant<N>) {
    let step = record.step();
    for c in 0..N {
        let bits = record.bits[c];
        let base = starts[c] * 32;
        for (i, vertex) in out.as_chunks_mut::<N>().0.iter_mut().enumerate() {
            let q = field(words, base + i * bits as usize, bits);
            vertex[c] = dequant(record.min[c], q, step).to_bits();
        }
    }
}

/// Indices first, all checked before a single float is written, then the attributes in stream order.
pub fn split(words: &[u32], h: &Header) -> Result<DecodedPage, PageError> {
    let layout = Layout::of(h);
    let n = h.vertex_count;
    let mut out = vec![0u32; h.decoded_bytes() / 4];
    let (indices, mut rest) = out.split_at_mut(h.index_count);
    for (i, index) in indices.iter_mut().enumerate() {
        *index = field(
            words,
            layout.indices * 32 + i * layout.index_bits as usize,
            layout.index_bits,
        );
        if *index as usize >= n {
            return Err(PageError::Index);
        }
    }
    let mut take = |width: usize| {
        let (head, tail) = core::mem::take(&mut rest).split_at_mut(n * width);
        rest = tail;
        head
    };
    vector(take(3), words, layout.position, &h.position);
    if h.flags & FLAG_NORMAL != 0 {
        for (i, normal) in take(3).as_chunks_mut::<3>().0.iter_mut().enumerate() {
            let unit = oct_decode(field(words, layout.normal * 32 + i * 16, 16));
            *normal = unit.map(f32::to_bits);
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
    Ok(DecodedPage {
        words: out,
        vertex_count: n,
        index_count: h.index_count,
        flags: h.flags,
        quantization_error: h.quantization_error,
    })
}
