//! Positions stored once (CMP-10). A flat-shaded page repeats each corner position under
//! every face normal that meets it; such a page stores its `position_count` distinct positions and,
//! after them, a link per vertex — `bits_for(position_count − 1)` bits, the rank of its position.
//! A page whose positions are all distinct, or whose links would cost more words than they save,
//! stores one position per vertex and no link. Either way a vertex decodes to the same
//! floats: the link only says where its position lies.

use crate::bits::{bits_for, dequant, BitReader};
use crate::{Header, Layout};

impl Header {
    /// Whether the vertices link to positions stored once, rather than carry one each.
    pub fn links_positions(&self) -> bool {
        self.position_count < self.vertex_count
    }

    /// Width of a vertex's link to its position: zero when one position serves every vertex.
    pub fn link_bits(&self) -> u32 {
        bits_for(self.position_count.saturating_sub(1) as u32)
    }
}

/// Every link names a stored position — the gate a reader that decodes in place relies on, as
/// for the block records. `body` is the page after its header, the layout already matched to it;
/// a link, at most 16 bits, lies within three bytes of its first.
pub(crate) fn links_fit(body: &[u8], layout: &Layout, h: &Header) -> bool {
    if !h.links_positions() {
        return true;
    }
    let (bits, stream) = (h.link_bits() as usize, &body[layout.links * 4..]);
    (0..h.vertex_count).all(|i| {
        let at = i * bits;
        let window = stream[at / 8..].iter().take(3).rev();
        let bytes = window.fold(0usize, |acc, &b| acc << 8 | usize::from(b));
        (bytes >> (at % 8) & ((1 << bits) - 1)) < h.position_count
    })
}

/// The vertices' positions, each dequantized in place from the stored one its link names —
/// field `i` of the link stream for vertex `i` —, with no intermediate table.
pub(crate) fn linked(out: &mut [u32], words: &[u32], layout: &Layout, h: &Header) {
    let (q, step) = (&h.position, h.position.step());
    let (bits, mut links) = (h.link_bits(), BitReader::at(words, layout.links * 32));
    for vertex in out.as_chunks_mut::<3>().0 {
        let at = links.read(bits) as usize;
        *vertex = core::array::from_fn(|c| {
            let start = layout.position[c] * 32 + at * q.bits[c] as usize;
            dequant(q.min[c], BitReader::at(words, start).read(q.bits[c]), step).to_bits()
        });
    }
}

#[cfg(test)]
#[path = "positions_tests.rs"]
mod tests;
