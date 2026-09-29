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
use super::cancel;
use std::sync::atomic::AtomicBool;

mod weld;

#[cfg(test)]
mod tests;
use crate::join::Join;

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
pub(super) fn corners(surface: &Surface<'_>, cancelled: &AtomicBool) -> Option<Shaded> {
    corners_with(surface, &mut |done| {
        (!cancel::stopped(cancelled, done)).then_some(())
    })
}

/// Runs each bounded work slice through the caller's cancellation checkpoint.
fn corners_with(
    surface: &Surface<'_>,
    check: &mut impl FnMut(usize) -> Option<()>,
) -> Option<Shaded> {
    check(0)?;
    let faces = surface.offsets.len().saturating_sub(1);
    let mut planes = Vec::with_capacity(faces);
    for face in 0..faces {
        check(face)?;
        planes.push(surface.newell(face, check)?);
    }
    let mut join = Join::new(surface.corners.len());
    surface.weld(&mut join, faces, check)?;
    let mut sums = vec![[0.0f32; 3]; surface.corners.len()];
    for (face, plane) in planes.iter().enumerate() {
        check(face)?;
        for corner in surface.span(face) {
            check(corner)?;
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
        check(face)?;
        let flat = unit(*plane).unwrap_or_default();
        for corner in surface.span(face) {
            check(corner)?;
            let group = join.root(corner as u32);
            out.normals
                .extend_from_slice(&unit(sums[group as usize]).unwrap_or(flat));
            out.groups.push(group);
        }
    }
    check(0)?;
    Some(out)
}

impl Surface<'_> {
    /// Corners of a face, in file order.
    fn span(&self, face: usize) -> std::ops::Range<usize> {
        self.offsets[face] as usize..self.offsets[face + 1] as usize
    }

    /// Newell sum of a face: its normal direction, of length twice its area.
    fn newell(&self, face: usize, check: &mut impl FnMut(usize) -> Option<()>) -> Option<[f32; 3]> {
        let span = self.span(face);
        let (first, length) = (span.start, span.len());
        let mut normal = [0.0f32; 3];
        for corner in span {
            check(corner)?;
            let here = self.point(corner);
            let there = self.point(first + (corner - first + 1) % length);
            normal[0] += (here[1] - there[1]) * (here[2] + there[2]);
            normal[1] += (here[2] - there[2]) * (here[0] + there[0]);
            normal[2] += (here[0] - there[0]) * (here[1] + there[1]);
        }
        Some(normal)
    }

    /// Position of a corner's vertex, or the origin when the table does not carry it.
    fn point(&self, corner: usize) -> [f32; 3] {
        let at = self.corners[corner] as usize * 3;
        self.positions
            .get(at..at + 3)
            .map_or([0.0; 3], |found| [found[0], found[1], found[2]])
    }
}

/// Unit vector, when there is a finite, non-zero length to divide by. Single precision on
/// purpose: the drivers write these normals and Blender's axes as they always have, and
/// `shared_math`'s double precision unit vectors round differently.
pub(super) fn unit(vector: [f32; 3]) -> Option<[f32; 3]> {
    let length = (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt();
    (length.is_finite() && length != 0.0)
        .then(|| [vector[0] / length, vector[1] / length, vector[2] / length])
}
