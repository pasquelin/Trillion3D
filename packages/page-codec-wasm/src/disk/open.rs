//! The page on disk read whole: the gate's `Raw` expanded to a page or a resident page.

use super::*;

impl Raw {
    /// The page whole, the vertices it names found: in the clusters of `referenced` — the
    /// resident page of the cluster each pair names, in the order of the pairs, from the
    /// cluster's first byte, whatever follows —, or in this very page for a pair that names the
    /// page itself (`SELF_PLACE`), which `referenced` then leaves empty. A pair `referenced` does
    /// not hold, a vertex past a cluster's or a cell past what this page's grids hold refuses the
    /// page (`PageError::Refs`).
    pub fn resolve(mut self, referenced: &[&[u8]]) -> Result<Page, PageError> {
        let h = &self.header;
        let mut residents: Vec<Option<Resident>> =
            (0..self.refs.pairs.len()).map(|_| None).collect();
        let mut at = 0;
        for v in 0..h.vertex_count {
            if !self.refs.named[v] {
                continue;
            }
            let (rank, index) = self.refs.entries[at];
            at += 1;
            let pair = self.refs.pairs[usize::from(rank)];
            let vertex = if pair == SELF_PLACE {
                let own = usize::from(index);
                if own >= v || self.refs.named[own] {
                    return Err(PageError::Refs);
                }
                Vertex::of(h, &self.cells[own])
            } else {
                let slot = &mut residents[usize::from(rank)];
                if slot.is_none() {
                    let bytes = referenced.get(usize::from(rank)).ok_or(PageError::Refs)?;
                    *slot = Some(Resident::read(bytes).map_err(|_| PageError::Refs)?);
                }
                let resident = slot.as_ref().ok_or(PageError::Refs)?;
                resident.vertex(usize::from(index)).ok_or(PageError::Refs)?
            };
            self.cells[v] = vertex.cell(h).ok_or(PageError::Refs)?;
        }
        let streams = Streams::of_cells(
            &self.header,
            &self.cells,
            self.table,
            (self.links, self.corners, self.deform),
        );
        Ok(Page {
            header: self.header,
            streams,
            strip: self.strip,
        })
    }
}

/// The page `data` whole (`read_raw`), the vertices it names found in `referenced` (`Raw::resolve`).
pub fn read(
    data: &[u8],
    max_decoded_bytes: usize,
    referenced: &[&[u8]],
) -> Result<Page, PageError> {
    read_raw(data, max_decoded_bytes)?.resolve(referenced)
}

/// The page `data` whole, the vertices it names found where `pool` holds the clusters that have
/// them (`Refs::pages_in`: `units` the starts, in words of `pool`, of its streaming page and of
/// each page its list of dependencies names).
pub fn read_in(
    data: &[u8],
    max_decoded_bytes: usize,
    (pool, units): (&[u8], &[u32]),
) -> Result<Page, PageError> {
    let raw = read_raw(data, max_decoded_bytes)?;
    let named = raw.refs.pages_in(pool, units)?;
    raw.resolve(&named)
}
