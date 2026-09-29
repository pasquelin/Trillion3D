//! Streams of a page and the block of words they unpack into (`unpack.rs`).

use crate::bits::stream_words;
use crate::triangles::CornerCode;
use crate::{Header, FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1, HEADER_BYTES};

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
    pub corners: CornerCode,
    /// The block table then the corner stream (`triangles.rs`).
    pub triangles: [usize; 2],
    pub position: [usize; 3],
    /// Each vertex's link to its position, present only when the page stores fewer positions
    /// than vertices (`positions.rs`).
    pub links: usize,
    pub normal: usize,
    pub uv: [usize; 2],
    pub uv1: [usize; 2],
    pub color: [usize; 4],
    /// Words of every stream together.
    pub words: usize,
}

impl Layout {
    pub fn of(h: &Header) -> Self {
        let corners = CornerCode::of(h.vertex_count, h.index_count, h.corner_bits);
        let mut at = 0usize;
        let mut stream = |present: bool, count: usize, bits: u32| {
            let start = at;
            if present {
                at += stream_words(count, bits);
            }
            start
        };
        let triangles = [
            stream(true, corners.blocks, corners.record_bits()),
            stream(true, corners.bits, 1),
        ];
        let position = h.position.bits.map(|b| stream(true, h.position_count, b));
        let links = stream(h.links_positions(), h.vertex_count, h.link_bits());
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
            corners,
            triangles,
            position,
            links,
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
