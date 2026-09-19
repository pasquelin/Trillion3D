//! A mesh part under construction: the corners already emitted, and the vertices they gave.
//!
//! A corner is a triplet (vertex, normal, texture coordinate). Two corners that carry the same
//! triplet are one glTF vertex; two corners that do not make two, because the format has only one
//! normal array and one coordinate array, indexed like the positions.
use super::super::geom::Geometry;
use super::super::TOPOLOGY_INVALID;
use super::Part;
use crate::plugins::scene::{cancel, ngon::Ngon};
use crate::{CompilerError, Result};
use std::{collections::HashMap, sync::atomic::AtomicBool};

/// A part under construction, with the table of corners already emitted.
#[derive(Default)]
pub(super) struct Builder {
    unique: HashMap<(u32, u32, u32), u32>,
    /// The polygon cutter and the current face's vertices, reused from one face to the next: a
    /// mesh of a thousand faces does not allocate a thousand rings.
    cutter: Ngon,
    ring: Vec<u32>,
    positions: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
    indices: Vec<u32>,
    min: [f32; 3],
    max: [f32; 3],
    started: bool,
}

impl Builder {
    /// Adds a face, read backwards and ear-clipped. Yields `false` when the face did not give
    /// all its ears: it then comes out fanned, and the caller counts it. The cutter rereads the
    /// cancellation token by face slice: a single huge mesh stops too, and the conversion then
    /// refuses whole.
    pub(super) fn face(
        &mut self,
        geometry: &Geometry,
        face: usize,
        corners: std::ops::Range<usize>,
        cancelled: &AtomicBool,
    ) -> Result<bool> {
        // The face is read backwards, corner by corner: each corner is emitted once, in this
        // order, before the cut says which triangles join them.
        self.ring.clear();
        self.cutter.begin();
        for corner in corners.rev() {
            let rank = self.corner(geometry, face, corner)?;
            self.ring.push(rank);
            self.cutter.corner(point(geometry, corner));
        }
        let Some(exact) = self.cutter.cut(cancelled) else {
            return Err(cancel::refusal());
        };
        for triangle in self.cutter.triangles() {
            let corners = triangle.map(|rank| self.ring[rank]);
            self.indices.extend_from_slice(&corners);
        }
        Ok(exact)
    }

    /// The glTF rank of this corner, emitted once per distinct triplet.
    fn corner(&mut self, geometry: &Geometry, face: usize, corner: usize) -> Result<u32> {
        let vertex = geometry
            .corners
            .get(corner)
            .copied()
            .and_then(|index| usize::try_from(index).ok())
            .filter(|vertex| (vertex + 1) * 3 <= geometry.positions.len())
            .ok_or_else(|| {
                CompilerError::new(
                    TOPOLOGY_INVALID,
                    "alembic: a face index falls outside the position table",
                )
            })?;
        let normal = geometry
            .normals
            .as_ref()
            .map_or(0, |param| param.slot(corner, vertex, face));
        let uv = geometry
            .uv
            .as_ref()
            .map_or(0, |param| param.slot(corner, vertex, face));
        let key = (u32::try_from(vertex).unwrap_or_default(), normal, uv);
        if let Some(known) = self.unique.get(&key) {
            return Ok(*known);
        }
        let rank = u32::try_from(self.unique.len()).unwrap_or_default();
        self.unique.insert(key, rank);
        self.push(geometry, vertex, normal, uv);
        Ok(rank)
    }

    /// Writes the values of a new vertex, and tracks the position extent.
    fn push(&mut self, geometry: &Geometry, vertex: usize, normal: u32, uv: u32) {
        let position = &geometry.positions[vertex * 3..vertex * 3 + 3];
        for (axis, value) in position.iter().enumerate() {
            if !self.started {
                self.min[axis] = *value;
                self.max[axis] = *value;
            }
            self.min[axis] = self.min[axis].min(*value);
            self.max[axis] = self.max[axis].max(*value);
        }
        self.started = true;
        self.positions.extend_from_slice(position);
        if let Some(values) = geometry.normals.as_ref().and_then(|p| p.value(normal)) {
            self.normals.extend_from_slice(values);
        }
        // glTF places the texture-coordinate origin at the top left, Alembic at the bottom left:
        // only the second coordinate changes direction, and the round-trip is exact.
        if let Some(values) = geometry.uv.as_ref().and_then(|p| p.value(uv)) {
            self.uvs.extend_from_slice(&[values[0], 1.0 - values[1]]);
        }
    }

    /// The finished part. An attribute array that does not cover every vertex does not enter
    /// glTF, where each attribute has exactly as many elements as positions.
    pub(super) fn finish(self, faceset: Option<usize>) -> Part {
        let vertices = self.positions.len() / 3;
        let full = |values: Vec<f32>, width: usize| {
            if values.len() == vertices * width {
                values
            } else {
                Vec::new()
            }
        };
        Part {
            faceset,
            normals: full(self.normals, 3),
            uvs: full(self.uvs, 2),
            positions: self.positions,
            indices: self.indices,
            min: self.min,
            max: self.max,
        }
    }
}

/// The position of a corner's vertex, as doubles, as the cutter reads it. A corner outside the
/// tables yields the origin: `corner` has already refused the file whose arrays contradict.
fn point(geometry: &Geometry, corner: usize) -> [f64; 3] {
    let vertex = geometry
        .corners
        .get(corner)
        .copied()
        .and_then(|index| usize::try_from(index).ok())
        .unwrap_or_default();
    geometry
        .positions
        .get(vertex * 3..vertex * 3 + 3)
        .map_or([0.0; 3], |axes| {
            [f64::from(axes[0]), f64::from(axes[1]), f64::from(axes[2])]
        })
}
