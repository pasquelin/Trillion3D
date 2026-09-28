//! Smoothing connectivity of the shared per-corner normal computation.
use super::*;
use std::collections::{hash_map::Entry, HashMap};

impl Surface<'_> {
    /// Unites the corners that soft edges join. A sharp face does not enter, a hard edge is
    /// skipped, and an edge that more than two faces share unites none of them: there is no fan
    /// to read there, and guessing would yield a corner at random.
    ///
    /// Incidences are counted **before** any union: uniting from the second encounter is
    /// deciding without knowing a third face exists, so smoothing the first two faces of the
    /// file and leaving the third alone. Face order then changed the output.
    ///
    /// They are also counted on **the whole** topology, marks included: an edge that three
    /// faces share keeps three, whether one of those faces is sharp or one of them declares it
    /// hard. Counting after filtering left two, and welded the two remaining faces as an
    /// ordinary border — a sharp edge rounded by the mark meant to cut it. Smoothing marks
    /// therefore only decide unions.
    pub(super) fn weld(
        &self,
        join: &mut Join,
        faces: usize,
        check: &mut impl FnMut(usize) -> Option<()>,
    ) -> Option<()> {
        let mut shared: HashMap<[u32; 2], usize> = HashMap::new();
        self.edges(faces, Edges::Every, check, |edge, _| {
            *shared.entry(edge).or_default() += 1;
        })?;
        let mut seen: HashMap<[u32; 2], [u32; 2]> = HashMap::new();
        let mut pairs: Vec<([u32; 2], [u32; 2])> = Vec::new();
        self.edges(faces, Edges::Smooth, check, |edge, side| {
            if shared.get(&edge) != Some(&2) {
                return;
            }
            match seen.entry(edge) {
                Entry::Vacant(slot) => {
                    slot.insert(side);
                }
                Entry::Occupied(slot) => pairs.push((side, *slot.get())),
            }
        })?;
        for (rank, (side, other)) in pairs.into_iter().enumerate() {
            check(rank)?;
            self.pair(join, side, other);
        }
        Some(())
    }

    /// Each edge of a face, once: its two vertices ordered, which identify it whatever the
    /// face's walk sense, then its two corners. `Edges::Smooth` keeps only those that can
    /// smooth; `Edges::Every` yields them all, that is topology alone.
    fn edges(
        &self,
        faces: usize,
        which: Edges,
        check: &mut impl FnMut(usize) -> Option<()>,
        mut each: impl FnMut([u32; 2], [u32; 2]),
    ) -> Option<()> {
        let smooth = which == Edges::Smooth;
        for face in 0..faces {
            check(face)?;
            if smooth && marked(self.sharp_faces, face) {
                continue;
            }
            let span = self.span(face);
            let (first, length) = (span.start, span.len());
            for corner in span {
                check(corner)?;
                if smooth && marked(self.sharp_corners, corner) {
                    continue;
                }
                let next = first + (corner - first + 1) % length;
                let (here, there) = (self.corners[corner], self.corners[next]);
                each(
                    [here.min(there), here.max(there)],
                    [corner as u32, next as u32],
                );
            }
        }
        Some(())
    }

    /// Unites, from both ends of a shared edge, the corners that carry the same vertex. The two
    /// faces ordinarily walk it in opposite senses, but a flipped mesh does not: it is the
    /// vertex that decides, never the order.
    fn pair(&self, join: &mut Join, side: [u32; 2], other: [u32; 2]) {
        for here in side {
            for there in other {
                if self.corners[here as usize] == self.corners[there as usize] {
                    join.unite(here, there);
                }
            }
        }
    }
}

/// Which edges a walk yields: those topology carries, or those that can smooth.
#[derive(Clone, Copy, PartialEq)]
enum Edges {
    /// All, marks included: that is what counts an edge's incident faces.
    Every,
    /// Soft edges of smooth faces, the only candidates for a union.
    Smooth,
}

/// Is this rank marked? A table shorter than the domain does not mark what it does not say.
fn marked(marks: &[bool], rank: usize) -> bool {
    marks.get(rank).copied().unwrap_or(false)
}
