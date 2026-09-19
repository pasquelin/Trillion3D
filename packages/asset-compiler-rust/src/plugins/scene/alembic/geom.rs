//! Geometry of a `PolyMesh` or `SubD` as the file carries it: positions, the face table, and the
//! geometry parameters this driver keeps — normals and texture coordinates.
//!
//! A geometry parameter declares its **scope** in its metadata: one value per vertex (`vtx`,
//! `var`), one per face corner (`fvr`), one per face (`uni`), or a single one for the whole mesh
//! (`con`). It is written either as direct values or — the usual case for texture coordinates —
//! as unique values plus an index table. Both forms are read here the same way: one rank per
//! corner, then the value at that rank.
use super::archive::{meta_value, Archive};
use super::property::{Properties, POD_F32, POD_I32, POD_U32};
use super::values::{f32s, i32s, u32s};
use crate::Result;

/// A parameter's scope: what its rank designates for a given face corner.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Scope {
    Vertex,
    FaceVarying,
    Uniform,
    Constant,
}

impl Scope {
    fn read(meta: &str) -> Scope {
        match meta_value(meta, "geoScope") {
            Some("fvr") => Scope::FaceVarying,
            Some("uni") => Scope::Uniform,
            Some("con") => Scope::Constant,
            _ => Scope::Vertex,
        }
    }
}

/// A geometry parameter ready to be read corner by corner.
pub(super) struct GeomParam {
    values: Vec<f32>,
    width: usize,
    indices: Option<Vec<u32>>,
    scope: Scope,
}

impl GeomParam {
    /// The rank of this corner's value: `corner` is its rank in the face-index table, `vertex`
    /// the vertex it designates, `face` the face it belongs to.
    pub(super) fn slot(&self, corner: usize, vertex: usize, face: usize) -> u32 {
        let raw = match self.scope {
            Scope::Vertex => vertex,
            Scope::FaceVarying => corner,
            Scope::Uniform => face,
            Scope::Constant => 0,
        };
        match &self.indices {
            Some(indices) => indices.get(raw).copied().unwrap_or_default(),
            None => u32::try_from(raw).unwrap_or_default(),
        }
    }

    /// The value at this rank, or `None` if the file places it outside what it wrote.
    pub(super) fn value(&self, slot: u32) -> Option<&[f32]> {
        let start = usize::try_from(slot).ok()?.checked_mul(self.width)?;
        self.values.get(start..start.checked_add(self.width)?)
    }

    /// Does the parameter cover every corner of this mesh? A parameter that overruns, for lack of
    /// a complete sample or coherent indices, is dropped whole rather than filled in.
    fn covers(&self, corners: &[i32], faces: usize) -> bool {
        let count = self.values.len() / self.width;
        let domain = match self.scope {
            Scope::Vertex => corners
                .iter()
                .copied()
                .max()
                .map_or(0, |highest| usize::try_from(highest).unwrap_or(0) + 1),
            Scope::FaceVarying => corners.len(),
            Scope::Uniform => faces,
            Scope::Constant => 1,
        };
        match &self.indices {
            Some(indices) => {
                indices.len() >= domain
                    && indices
                        .iter()
                        .all(|slot| usize::try_from(*slot).unwrap_or(usize::MAX) < count)
            }
            None => count >= domain,
        }
    }
}

/// Geometry read from a mesh: a position table, one face per count, and its parameters.
pub(super) struct Geometry {
    pub(super) positions: Vec<f32>,
    pub(super) counts: Vec<i32>,
    pub(super) corners: Vec<i32>,
    pub(super) normals: Option<GeomParam>,
    pub(super) uv: Option<GeomParam>,
    /// What the read dropped, to count on the driver's report.
    pub(super) dropped: Vec<&'static str>,
}

impl Geometry {
    /// Reads the geometry of a `.geom`. Yields `None` when the topology is not there: a mesh
    /// without positions, faces or indices is not an incomplete mesh, it is something else.
    pub(super) fn read(archive: &Archive, geom: &Properties) -> Result<Option<Geometry>> {
        let (Some(positions), Some(counts), Some(corners)) = (
            geom.sample(archive, "P", POD_F32, Some(3))?,
            geom.sample(archive, ".faceCounts", POD_I32, Some(1))?,
            geom.sample(archive, ".faceIndices", POD_I32, Some(1))?,
        ) else {
            return Ok(None);
        };
        let mut out = Geometry {
            positions: f32s(positions),
            counts: i32s(counts),
            corners: i32s(corners),
            normals: None,
            uv: None,
            dropped: Vec::new(),
        };
        out.normals = out.param(archive, geom, "N", 3, "alembic-normals-dropped")?;
        out.uv = out.param(archive, geom, "uv", 2, "alembic-uv-dropped")?;
        Ok(Some(out))
    }

    /// A named geometry parameter, in either of its two forms, once checked that it covers every
    /// corner. Otherwise it is dropped under the given name.
    fn param(
        &mut self,
        archive: &Archive,
        geom: &Properties,
        name: &str,
        width: usize,
        dropped: &'static str,
    ) -> Result<Option<GeomParam>> {
        let Some(found) = read_param(archive, geom, name, width)? else {
            return Ok(None);
        };
        if !found.covers(&self.corners, self.counts.len()) {
            self.dropped.push(dropped);
            return Ok(None);
        }
        Ok(Some(found))
    }
}

/// The named parameter, whether written as direct values or as indexed values.
fn read_param(
    archive: &Archive,
    geom: &Properties,
    name: &str,
    width: usize,
) -> Result<Option<GeomParam>> {
    let Some(header) = geom.find(name) else {
        return Ok(None);
    };
    let scope = Scope::read(&header.meta);
    if let Some(compound) = geom.compound(archive, name)? {
        let Some(values) = compound.sample(archive, ".vals", POD_F32, Some(width as u8))? else {
            return Ok(None);
        };
        let indices = compound
            .sample(archive, ".indices", POD_U32, Some(1))?
            .map(u32s);
        return Ok(Some(GeomParam {
            values: f32s(values),
            width,
            indices,
            scope,
        }));
    }
    Ok(geom
        .sample(archive, name, POD_F32, Some(width as u8))?
        .map(|values| GeomParam {
            values: f32s(values),
            width,
            indices: None,
            scope,
        }))
}
