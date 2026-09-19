//! From read geometry to parts of a glTF mesh: one part per face set, plus one part for faces
//! no face set claims.
//!
//! Two conversions happen here, and they are exact. **Winding**: Alembic describes its faces
//! clockwise seen from outside, glTF in the reverse order; reading each face backwards is enough,
//! and nothing else changes — no vertex is moved. **Corner splitting**: an Alembic file gives one
//! position per vertex but may give a normal and a texture coordinate per face corner, where
//! glTF has only one array per vertex; each distinct triplet (vertex, normal, coordinate) therefore
//! becomes a glTF vertex, and identical triplets stay one vertex. Faces of more than three sides
//! are ear-clipped in the plane of their normal, which keeps the area and silhouette of a planar
//! face, whether convex or concave.
use self::build::Builder;
use super::geom::Geometry;
use super::TOPOLOGY_INVALID;
use crate::{CompilerError, Result};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

mod build;

/// Corners at most in a mesh. Beyond that, it is no longer a scene but a corrupted table.
const MAX_CORNERS: usize = 64 << 20;

/// A face set: a material name and the faces it holds.
pub(super) struct FaceSet {
    pub(super) name: String,
    pub(super) faces: Vec<i32>,
}

/// A mesh part ready to become a glTF primitive.
pub(super) struct Part {
    /// The rank of the face set this part comes from, or `None` for faces with no face set.
    pub(super) faceset: Option<usize>,
    pub(super) positions: Vec<f32>,
    pub(super) normals: Vec<f32>,
    pub(super) uvs: Vec<f32>,
    pub(super) indices: Vec<u32>,
    pub(super) min: [f32; 3],
    pub(super) max: [f32; 3],
}

/// What the split met and the report must say.
#[derive(Default)]
pub(super) struct Counted {
    /// Faces claimed by two face sets: only the first claim counts.
    pub(super) overlaps: usize,
    /// Faces of fewer than three sides, which carry no surface.
    pub(super) degenerate: usize,
    /// Faces that ear-clipping could not fully cut.
    pub(super) uncut: usize,
}

/// The face set of each face, and what the assignment met. A face claimed twice stays with the
/// first face set: a triangle belongs to only one material.
fn assign(facesets: &[FaceSet], faces: usize) -> (Vec<Option<usize>>, usize) {
    let mut out = vec![None; faces];
    let mut overlaps = 0;
    for (rank, faceset) in facesets.iter().enumerate() {
        for face in &faceset.faces {
            let Ok(face) = usize::try_from(*face) else {
                continue;
            };
            match out.get(face) {
                Some(None) => out[face] = Some(rank),
                Some(Some(_)) => overlaps += 1,
                None => {}
            }
        }
    }
    (out, overlaps)
}

/// Splits the geometry into parts, one per used face set, in face-set order. The cancellation
/// token is reread by face slice: a single huge mesh stops too.
pub(super) fn parts(
    geometry: &Geometry,
    facesets: &[FaceSet],
    cancelled: &AtomicBool,
) -> Result<(Vec<Part>, Counted)> {
    if geometry.corners.len() > MAX_CORNERS {
        return Err(CompilerError::new(
            TOPOLOGY_INVALID,
            format!(
                "alembic: a mesh declares {} face corners, above the {MAX_CORNERS} ceiling",
                geometry.corners.len()
            ),
        ));
    }
    let (owner, overlaps) = assign(facesets, geometry.counts.len());
    let mut counted = Counted {
        overlaps,
        ..Counted::default()
    };
    let mut builders: HashMap<Option<usize>, Builder> = HashMap::new();
    let mut at = 0usize;
    for (face, count) in geometry.counts.iter().enumerate() {
        let sides = usize::try_from(*count).unwrap_or(0);
        let corners = at..at.saturating_add(sides);
        at = corners.end;
        if sides < 3 {
            counted.degenerate += 1;
            continue;
        }
        if corners.end > geometry.corners.len() {
            return Err(CompilerError::new(
                TOPOLOGY_INVALID,
                "alembic: a mesh declares more face corners than it carries face indices",
            ));
        }
        let owner = owner.get(face).copied().flatten();
        let builder = builders.entry(owner).or_default();
        if !builder.face(geometry, face, corners, cancelled)? {
            counted.uncut += 1;
        }
    }
    let mut out: Vec<Part> = builders
        .into_iter()
        .map(|(faceset, builder)| builder.finish(faceset))
        .filter(|part| !part.indices.is_empty())
        .collect();
    out.sort_by_key(|part| (part.faceset.is_none(), part.faceset.unwrap_or(0)));
    Ok((out, counted))
}
