//! A face corner into a glTF vertex: what identifies it, and what it carries.
//!
//! A glTF vertex carries one position, one normal and one texture coordinate. Two corners of a
//! Maya mesh that differ by any of the three are therefore two vertices, and two corners that
//! share all three are one: it is that equality, never a rounding nor a distance, that decides
//! what merges and what splits.
use super::*;
use crate::import::Corner;
use crate::plugins::scene::corners::gltf_uv;
use trillion3d_math::vec3::normalized_or;

impl Surface {
    /// The point of a face corner, as the cutter reads it.
    pub(super) fn point(&self, face: usize, rank: usize) -> [f64; 3] {
        let vertex = self.loops.get(face).and_then(|ring| ring.get(rank));
        vertex
            .and_then(|vertex| self.positions.get(*vertex as usize))
            .copied()
            .unwrap_or_default()
    }

    /// What identifies a face corner, and the vertex it carries. Three indices identify it: its
    /// position, its texture coordinate and its normal — the place it is read when the file
    /// writes it, its smoothing group when this driver computes it. Two corners that share all
    /// three are the same vertex. `None` when the tables do not carry the corner.
    pub(super) fn key(
        &self,
        (face, rank): (usize, usize),
        textured: bool,
    ) -> Option<([u32; 3], Corner)> {
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
        let position = self.positions.get(vertex as usize)?.map(|axis| axis as f32);
        let written = self.normals.get(shade).copied().unwrap_or([0.0, 1.0, 0.0]);
        let normal = normalized_or(written, [0.0, 1.0, 0.0]).map(|axis| axis as f32);
        let uv = textured.then(|| {
            let [u, v] = uv.map_or([0.0, 0.0], |slot| self.uvs[slot]);
            gltf_uv([u as f32, v as f32])
        });
        Some((
            key,
            Corner {
                position,
                normal,
                uv,
            },
        ))
    }
}
