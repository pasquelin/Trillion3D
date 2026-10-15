use super::*;

/// What a header's counts make of the page's size.
impl Header {
    /// Floats per decoded vertex: every attribute the page carries at its width
    /// (`attribute_widths`).
    pub fn vertex_floats(&self) -> usize {
        attribute_widths(self.flags, self.skin.influences, self.morphs.len())
            .flatten()
            .sum()
    }

    /// Bytes before the first stream: the header words and the morph targets' records.
    pub fn bytes(&self) -> usize {
        HEADER_BYTES + self.morphs.len() * deform::MORPH_WORDS * 4
    }

    /// Decoded bytes, saturated so forged counts cannot wrap below the allocation budget.
    pub fn decoded_bytes(&self) -> usize {
        self.vertex_count
            .saturating_mul(self.vertex_floats() * 4)
            .saturating_add(self.index_count.saturating_mul(4))
    }
}
