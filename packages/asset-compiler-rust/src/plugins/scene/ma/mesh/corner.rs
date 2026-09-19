//! A face corner into a glTF vertex: what identifies it, and what it carries.
//!
//! A glTF vertex carries one position, one normal and one texture coordinate. Two corners of a
//! Maya mesh that differ by any of the three are therefore two vertices, and two corners that
//! share all three are one: it is that equality, never a rounding nor a distance, that decides
//! what merges and what splits.
use super::*;
use crate::import::Vertices;
use crate::plugins::scene::ngon::Ngon;

impl Surface {
    /// Pours a face ring into the cutter and cuts it. Yields `None` when cancellation stops the
    /// cut, `Some(false)` when the face did not yield all its ears: it then comes out as a fan,
    /// and the caller counts it.
    pub(super) fn cut(
        &self,
        cutter: &mut Ngon,
        face: usize,
        cancelled: &AtomicBool,
    ) -> Option<bool> {
        cutter.begin();
        for vertex in self.loops.get(face).map_or(&[][..], Vec::as_slice) {
            let point = self.positions.get(*vertex as usize);
            cutter.corner(point.copied().unwrap_or_default());
        }
        cutter.cut(cancelled)
    }

    /// glTF vertex of a face corner, created on first encounter. Three indices identify it: its
    /// position, its texture coordinate and its normal — the place it is read when the file
    /// writes it, its smoothing group when this driver computes it. Two corners that share all
    /// three are the same vertex.
    pub(super) fn corner(
        &self,
        out: &mut Vertices,
        unique: &mut HashMap<[u32; 3], u32>,
        (face, rank): (usize, usize),
        textured: bool,
    ) -> Option<u32> {
        let vertex = *self.loops.get(face)?.get(rank)?;
        let uv = textured
            .then(|| self.uv_slots.get(face)?.get(rank).copied())
            .flatten()
            .and_then(|slot| usize::try_from(slot).ok())
            .filter(|slot| *slot < self.uvs.len());
        let shade = match self.shading {
            Shading::Vertex => vertex as usize,
            Shading::Corner => self.bases.get(face)? + rank,
        };
        // Two corners of the same smoothing group carry the same normal: they are one vertex,
        // and that is how a soft edge is not paid for in duplicated vertices.
        let shared = match self.groups.get(shade) {
            Some(group) => *group,
            None => u32::try_from(shade).ok()?,
        };
        let key = [
            vertex,
            uv.and_then(|slot| u32::try_from(slot).ok())
                .unwrap_or(u32::MAX),
            shared,
        ];
        if let Some(known) = unique.get(&key) {
            return Some(*known);
        }
        let id = u32::try_from(unique.len()).ok()?;
        let position = self.positions.get(vertex as usize)?;
        out.positions.extend(position.map(|axis| axis as f32));
        let written = self.normals.get(shade).copied().unwrap_or([0.0, 1.0, 0.0]);
        let normal = crate::shared_math::normalized_or(written, [0.0, 1.0, 0.0]);
        out.normals.extend(normal.map(|axis| axis as f32));
        if textured {
            let [u, v] = uv.map_or([0.0, 0.0], |slot| self.uvs[slot]);
            out.uvs.extend([u as f32, 1.0 - v as f32]);
        }
        unique.insert(key, id);
        Some(id)
    }
}
