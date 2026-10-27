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
use crate::plugins::scene::spread::Spread;
use crate::support::le::words;
use crate::Result;

/// A parameter's scope, read from its metadata, as the spread it names.
pub(super) fn scope_of(meta: &str) -> Spread {
    match meta_value(meta, "geoScope") {
        Some("fvr") => Spread::FaceVarying,
        Some("uni") => Spread::Uniform,
        Some("con") => Spread::Constant,
        _ => Spread::Point,
    }
}

/// A geometry parameter ready to be read corner by corner.
pub(super) struct GeomParam {
    param: Param<f32>,
    width: usize,
}

impl GeomParam {
    /// The rank of this corner's value: the one rule of `Spread::slot`. `corner` is its rank in
    /// the face-index table, `vertex` the vertex it designates, `face` the face it belongs to.
    pub(super) fn slot(&self, corner: usize, vertex: usize, face: usize) -> Option<u32> {
        let param = &self.param;
        param
            .scope
            .slot(param.indices.as_deref(), corner, face, vertex)
    }

    /// The value at this rank, or `None` if the file places it outside what it wrote.
    pub(super) fn value(&self, slot: u32) -> Option<&[f32]> {
        let start = usize::try_from(slot).ok()?.checked_mul(self.width)?;
        self.param.values.get(start..start.checked_add(self.width)?)
    }

    /// Does the parameter cover every corner of this mesh? A parameter that overruns, for lack of
    /// a complete sample or coherent indices, is dropped whole rather than filled in.
    fn covers(&self, corners: &[i32], faces: usize) -> bool {
        let count = self.param.values.len() / self.width;
        let domain = match self.param.scope {
            Spread::Point => corners
                .iter()
                .copied()
                .max()
                .map_or(0, |highest| usize::try_from(highest).unwrap_or(0) + 1),
            Spread::FaceVarying => corners.len(),
            Spread::Uniform => faces,
            Spread::Constant => 1,
        };
        match &self.param.indices {
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
            positions: words(positions, f32::from_le_bytes).collect(),
            counts: words(counts, i32::from_le_bytes).collect(),
            corners: words(corners, i32::from_le_bytes).collect(),
            normals: None,
            uv: None,
            dropped: Vec::new(),
        };
        out.normals = out.param(
            archive,
            geom,
            "N",
            3,
            crate::plugins::scene::codes::NORMALS_DROPPED,
        )?;
        out.uv = out.param(
            archive,
            geom,
            "uv",
            2,
            crate::plugins::scene::codes::UV_DROPPED,
        )?;
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
        let Some(found) = read_param(archive, geom, name, width as u8, single_floats)? else {
            return Ok(None);
        };
        let found = GeomParam {
            param: found,
            width,
        };
        if !found.covers(&self.corners, self.counts.len()) {
            self.dropped.push(dropped);
            return Ok(None);
        }
        Ok(Some(found))
    }
}

/// A geometry parameter as the file writes it: its values, `extent` numbers each, the index table of
/// an indexed one, and the scope it declares.
pub(super) struct Param<T> {
    pub(super) values: Vec<T>,
    pub(super) indices: Option<Vec<u32>>,
    pub(super) scope: Spread,
    /// Whether the file names the scope `vertex`, which `scope` folds with `varying` and the scopes
    /// it does not know.
    pub(super) vertex: bool,
}

impl<T: Clone> Param<T> {
    /// The values behind the index table, `extent` numbers each: those of the parameter itself when
    /// it is not indexed. `None` when an index leaves the values.
    pub(super) fn expanded(self, extent: usize) -> Option<Vec<T>> {
        let Some(indices) = self.indices else {
            return Some(self.values);
        };
        let mut out = Vec::with_capacity(indices.len() * extent);
        for slot in indices {
            let start = usize::try_from(slot).ok()?.checked_mul(extent)?;
            out.extend_from_slice(self.values.get(start..start.checked_add(extent)?)?);
        }
        Some(out)
    }
}

/// The values of `bytes`, written as the data type `pod`, or `None` for a type the reader does not
/// take: what a parameter's decoder answers.
pub(super) type Decode<T> = fn(u32, &[u8]) -> Option<Vec<T>>;

/// The values of single-precision floats, and of nothing else.
pub(super) fn single_floats(pod: u32, bytes: &[u8]) -> Option<Vec<f32>> {
    (pod == POD_F32).then(|| words(bytes, f32::from_le_bytes).collect())
}

/// The named parameter of `extent` numbers each, whether written as direct values or as indexed
/// values, decoded by `decode`.
pub(super) fn read_param<T>(
    archive: &Archive,
    props: &Properties,
    name: &str,
    extent: u8,
    decode: Decode<T>,
) -> Result<Option<Param<T>>> {
    let Some(header) = props.find(name) else {
        return Ok(None);
    };
    let (scope, vertex) = (
        scope_of(&header.meta),
        meta_value(&header.meta, "geoScope") == Some("vtx"),
    );
    let (values, indices) = match props.compound(archive, name)? {
        Some(compound) => (
            compound.decoded(archive, ".vals", extent, decode)?,
            compound
                .sample(archive, ".indices", POD_U32, Some(1))?
                .map(|bytes| words(bytes, u32::from_le_bytes).collect()),
        ),
        None => (props.decoded(archive, name, extent, decode)?, None),
    };
    Ok(values.map(|values| Param {
        values,
        indices,
        scope,
        vertex,
    }))
}
