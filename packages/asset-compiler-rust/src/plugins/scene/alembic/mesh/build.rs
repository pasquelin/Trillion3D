//! A mesh part under construction: the corners already emitted, and the vertices they gave.
//!
//! A corner is a triplet (vertex, normal, texture coordinate). Two corners that carry the same
//! triplet are one glTF vertex; two corners that do not make two, because the format has only one
//! normal array and one coordinate array, indexed like the positions.
use super::super::geom::{GeomParam, Geometry};
use super::super::TOPOLOGY_INVALID;
use super::Part;
use crate::import::Vertices;
use crate::plugins::scene::cancel;
use crate::plugins::scene::corners::{gltf_uv, Corners};
use crate::{CompilerError, Result};
use std::sync::atomic::AtomicBool;

/// A part under construction: the one corner builder, keyed by the three slots a corner reads.
pub(super) struct Builder(Corners<(u32, u32, u32)>);

impl Default for Builder {
    fn default() -> Self {
        Self(Corners::new(Vertices::default()))
    }
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
        let before = self.0.uncut;
        self.0.begin();
        for corner in corners.rev() {
            let key = key(geometry, face, corner)?;
            self.0
                .corner(key, point(geometry, corner), |out| push(geometry, key, out));
        }
        self.0.cut(cancelled, false).ok_or_else(cancel::refusal)?;
        Ok(self.0.uncut == before)
    }

    /// The finished part. An attribute array that does not cover every vertex does not enter
    /// glTF, where each attribute has exactly as many elements as positions.
    pub(super) fn finish(self, faceset: Option<usize>) -> Part {
        let mut vertices = self.0.vertices;
        let count = vertices.count();
        if vertices.normals.len() != count * 3 {
            vertices.normals = Vec::new();
        }
        if vertices.uvs.len() != count * 2 {
            vertices.uvs = Vec::new();
        }
        Part { faceset, vertices }
    }
}

/// What identifies a corner: its vertex, and the slots its normal and texture coordinate read.
/// A face index outside the positions, or a parameter index outside its table, refuses the file.
fn key(geometry: &Geometry, face: usize, corner: usize) -> Result<(u32, u32, u32)> {
    let invalid = |what| CompilerError::new(TOPOLOGY_INVALID, what);
    let vertex = geometry
        .corners
        .get(corner)
        .copied()
        .and_then(|index| usize::try_from(index).ok())
        .filter(|vertex| (vertex + 1) * 3 <= geometry.positions.len())
        .ok_or_else(|| invalid("alembic: a face index falls outside the position table"))?;
    let slot = |param: Option<&GeomParam>| match param {
        Some(param) => param.slot(corner, vertex, face),
        None => Some(0),
    };
    let (Some(normal), Some(uv)) = (slot(geometry.normals.as_ref()), slot(geometry.uv.as_ref()))
    else {
        return Err(invalid(
            "alembic: a parameter index falls outside its table",
        ));
    };
    Ok((vertex as u32, normal, uv))
}

/// Writes the values of a new vertex.
fn push(geometry: &Geometry, (vertex, normal, uv): (u32, u32, u32), out: &mut Vertices) {
    let at = vertex as usize * 3;
    out.positions
        .extend_from_slice(&geometry.positions[at..at + 3]);
    if let Some(values) = geometry.normals.as_ref().and_then(|p| p.value(normal)) {
        out.normals.extend_from_slice(values);
    }
    if let Some(values) = geometry.uv.as_ref().and_then(|p| p.value(uv)) {
        out.uvs.extend(gltf_uv([values[0], values[1]]));
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
