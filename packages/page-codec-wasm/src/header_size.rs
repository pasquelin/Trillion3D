use super::*;

/// What a header's counts make of the page's size.
impl Header {
    /// Floats per decoded vertex: position, then each present attribute at its width.
    pub fn vertex_floats(&self) -> usize {
        3 + OPTIONAL
            .iter()
            .filter(|(bit, _)| self.flags & bit != 0)
            .map(|(_, size)| size)
            .sum::<usize>()
            + self.deformation_floats()
    }

    /// Extra floats per vertex: twice the influence count, six per morph target.
    pub fn deformation_floats(&self) -> usize {
        let skin = if self.flags & FLAG_SKIN != 0 {
            2 * self.skin.influences
        } else {
            0
        };
        skin + 6 * self.morphs.len()
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
