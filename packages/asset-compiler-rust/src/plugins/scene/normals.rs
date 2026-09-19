//! Per-corner normals of a mesh, hard edges included. Shared by the drivers that compute their
//! normals rather than reading them — `ma` and `blend`.
//!
//! A face's normal comes from Newell's formula, which holds for an arbitrary polygon and whose
//! length is twice the area: it is therefore also the natural weighting of a per-vertex average.
//! What decides smoothing is neither the format nor the object type, but two marks that both
//! formats write each in their own way: a **sharp face** keeps its own normal on each of its
//! corners, and a **hard edge** cuts continuity between the two faces it separates.
//!
//! Smoothing is therefore read by **fans**: two corners of the same vertex only average if they
//! meet through a chain of soft edges between smooth faces. Averaging every corner of a vertex,
//! as if the edge did not exist, rounds a sharp edge; averaging none of them yields a faceted
//! sphere. Those are the two defects this computation replaces.
use std::collections::hash_map::Entry;
use std::collections::HashMap;

mod join;
#[cfg(test)]
mod tests;
use join::Join;

/// What this computation reads of a mesh. Both mark tables are read by their rank when it is in
/// them: an empty table therefore says “nothing sharp”, which is the fully smooth mesh.
pub(super) struct Surface<'a> {
    /// Three floats per vertex.
    pub(super) positions: &'a [f32],
    /// Vertex of each corner.
    pub(super) corners: &'a [u32],
    /// First corner of each face, plus the end of the last: `faces + 1` values.
    pub(super) offsets: &'a [u32],
    /// The face keeps its own normal on all its corners.
    pub(super) sharp_faces: &'a [bool],
    /// The edge that leads from this corner to the next of its face is hard.
    pub(super) sharp_corners: &'a [bool],
}

/// Normals of each corner, and the smoothing group it belongs to. Two corners of the same group
/// carry exactly the same normal: the caller can write only one vertex of them.
pub(super) struct Shaded {
    /// Three floats per corner.
    pub(super) normals: Vec<f32>,
    /// One group rank per corner.
    pub(super) groups: Vec<u32>,
}

/// Per-corner normals of this surface.
pub(super) fn corners(surface: &Surface<'_>) -> Shaded {
    let faces = surface.offsets.len().saturating_sub(1);
    let planes: Vec<[f32; 3]> = (0..faces).map(|face| surface.newell(face)).collect();
    let mut join = Join::new(surface.corners.len());
    surface.weld(&mut join, faces);
    let mut sums = vec![[0.0f32; 3]; surface.corners.len()];
    for (face, plane) in planes.iter().enumerate() {
        for corner in surface.span(face) {
            let into = &mut sums[join.root(corner as u32) as usize];
            for axis in 0..3 {
                into[axis] += plane[axis];
            }
        }
    }
    let mut out = Shaded {
        normals: Vec::with_capacity(surface.corners.len() * 3),
        groups: Vec::with_capacity(surface.corners.len()),
    };
    for (face, plane) in planes.iter().enumerate() {
        let flat = unit(*plane);
        for corner in surface.span(face) {
            let group = join.root(corner as u32);
            let mixed = unit(sums[group as usize]);
            out.normals
                .extend_from_slice(&if mixed == [0.0; 3] { flat } else { mixed });
            out.groups.push(group);
        }
    }
    out
}

impl Surface<'_> {
    /// Corners of a face, in file order.
    fn span(&self, face: usize) -> std::ops::Range<usize> {
        self.offsets[face] as usize..self.offsets[face + 1] as usize
    }

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
    fn weld(&self, join: &mut Join, faces: usize) {
        let mut shared: HashMap<[u32; 2], usize> = HashMap::new();
        self.edges(faces, Edges::Every, |edge, _| {
            *shared.entry(edge).or_default() += 1;
        });
        let mut seen: HashMap<[u32; 2], [u32; 2]> = HashMap::new();
        let mut pairs: Vec<([u32; 2], [u32; 2])> = Vec::new();
        self.edges(faces, Edges::Smooth, |edge, side| {
            if shared.get(&edge) != Some(&2) {
                return;
            }
            match seen.entry(edge) {
                Entry::Vacant(slot) => {
                    slot.insert(side);
                }
                Entry::Occupied(slot) => pairs.push((side, *slot.get())),
            }
        });
        for (side, other) in pairs {
            self.pair(join, side, other);
        }
    }

    /// Each edge of a face, once: its two vertices ordered, which identify it whatever the
    /// face's walk sense, then its two corners. `Edges::Smooth` keeps only those that can
    /// smooth; `Edges::Every` yields them all, that is topology alone.
    fn edges(&self, faces: usize, which: Edges, mut each: impl FnMut([u32; 2], [u32; 2])) {
        let smooth = which == Edges::Smooth;
        for face in (0..faces).filter(|face| !smooth || !marked(self.sharp_faces, *face)) {
            let span = self.span(face);
            let (first, length) = (span.start, span.len());
            for corner in span.filter(|corner| !smooth || !marked(self.sharp_corners, *corner)) {
                let next = first + (corner - first + 1) % length;
                let (here, there) = (self.corners[corner], self.corners[next]);
                each(
                    [here.min(there), here.max(there)],
                    [corner as u32, next as u32],
                );
            }
        }
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

    /// Newell sum of a face: its normal direction, of length twice its area.
    fn newell(&self, face: usize) -> [f32; 3] {
        let span = self.span(face);
        let (first, length) = (span.start, span.len());
        let mut normal = [0.0f32; 3];
        for corner in span {
            let here = self.point(corner);
            let there = self.point(first + (corner - first + 1) % length);
            normal[0] += (here[1] - there[1]) * (here[2] + there[2]);
            normal[1] += (here[2] - there[2]) * (here[0] + there[0]);
            normal[2] += (here[0] - there[0]) * (here[1] + there[1]);
        }
        normal
    }

    /// Position of a corner's vertex, or the origin when the table does not carry it.
    fn point(&self, corner: usize) -> [f32; 3] {
        let at = self.corners[corner] as usize * 3;
        self.positions
            .get(at..at + 3)
            .map_or([0.0; 3], |found| [found[0], found[1], found[2]])
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

/// Unit vector, or the null vector when there is no direction to give.
fn unit(vector: [f32; 3]) -> [f32; 3] {
    let length = (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt();
    if !length.is_finite() || length == 0.0 {
        return [0.0, 0.0, 0.0];
    }
    [vector[0] / length, vector[1] / length, vector[2] / length]
}
