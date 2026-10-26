use crate::attributes::*;
use crate::{HEADER_UV_SETS, RESIDENT_TABLE_WORDS, UV_EXTENSION_WORDS};

/// What a header's counts make of the page's size.
impl Header {
    /// Floats per decoded vertex: every attribute the page carries at its width
    /// (`attribute_widths`).
    pub fn vertex_floats(&self) -> usize {
        attribute_widths(self.flags, self.skin.influences, self.morphs.len())
            .flatten()
            .sum()
    }

    /// Bytes of the resident page, which the install pass writes into the pool: what the page's
    /// counts and widths make of its layout (`Layout`), not what it takes on disk.
    pub fn resident_bytes(&self) -> usize {
        Layout::of(self).bytes()
    }

    /// The texture sets past the fixed header's the page carries, in set order: each has its
    /// ranges in the header's extension.
    pub fn extended_sets(&self) -> impl Iterator<Item = usize> + '_ {
        (HEADER_UV_SETS..MAX_UV_SETS).filter(|&set| self.flags & UV_FLAGS[set] != 0)
    }

    /// Words of the extension that follows the morph targets' records.
    pub fn extension_words(&self) -> usize {
        self.extended_sets().count() * UV_EXTENSION_WORDS
    }

    /// Bytes before the first stream: the header words, the morph targets' records and the
    /// extension.
    pub fn bytes(&self) -> usize {
        HEADER_BYTES + (self.morphs.len() * deform::MORPH_WORDS + self.extension_words()) * 4
    }

    /// Bytes before the first stream of a resident page: the header, the records, the extension
    /// and the table of the streams' offsets (`Layout::table`).
    pub fn body_at(&self) -> usize {
        self.bytes() + RESIDENT_TABLE_WORDS * 4
    }

    /// Decoded bytes, saturated so forged counts cannot wrap below the allocation budget.
    pub fn decoded_bytes(&self) -> usize {
        self.vertex_count
            .saturating_mul(self.vertex_floats() * 4)
            .saturating_add(self.index_count.saturating_mul(4))
    }
}
