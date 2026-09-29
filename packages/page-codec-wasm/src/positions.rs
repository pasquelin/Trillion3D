//! Positions stored once (CMP-10, #960). A flat-shaded page repeats each corner position under
//! every face normal that meets it; such a page stores its `position_count` distinct positions and,
//! after them, a link per vertex — `bits_for(position_count − 1)` bits, the rank of its position.
//! A page whose positions are all distinct, or whose links would cost more words than they save,
//! stores one position per vertex and no link, as before. Either way a vertex decodes to the same
//! floats: the link only says where its position lies.

use crate::bits::{bits_for, le_words, stream_words, BitReader};
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
/// for the block records. `body` is the page after its header, the layout already matched to it.
pub(crate) fn links_fit(body: &[u8], layout: &Layout, h: &Header) -> bool {
    if !h.links_positions() {
        return true;
    }
    let bits = h.link_bits();
    let bytes = &body[layout.links * 4..][..stream_words(h.vertex_count, bits) * 4];
    let words: Vec<u32> = le_words(bytes).collect();
    let mut links = BitReader::at(&words, 0);
    (0..h.vertex_count).all(|_| (links.read(bits) as usize) < h.position_count)
}

/// The vertices' positions from the page's distinct ones, `table` holding three words each:
/// vertex `i` takes the position its link, field `i` of the link stream, names.
pub(crate) fn link(out: &mut [u32], table: &[u32], words: &[u32], layout: &Layout, h: &Header) {
    let (bits, mut links) = (h.link_bits(), BitReader::at(words, layout.links * 32));
    for vertex in out.as_chunks_mut::<3>().0 {
        let at = links.read(bits) as usize * 3;
        vertex.copy_from_slice(&table[at..at + 3]);
    }
}

#[cfg(test)]
#[path = "positions_tests.rs"]
mod tests;
