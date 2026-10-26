//! A primitive's displacement baked into its triangles, before its clusters are built
//! (`displace`): where its mesh names height maps (`meshBuild`'s `displacementMaps`) and a
//! `trimmedError`, and it deforms nothing, its source as the build lays it — vertices built, the
//! triangles that meet dropped, the corners welded (`dag::laid_source`) — is tessellated and moved
//! along its normals, with the sources of the mesh's other primitives as one soup, each by the map
//! of its rank. The first primitive of a mesh to ask bakes the mesh (`bake_of_mesh`); each takes
//! its triangles from it. Its build then reads the displaced mesh as made (`InputRules::as_made`): the
//! normals the tessellation blended are kept, not rebuilt from the displaced triangles. Every
//! consumer of the primitive's triangles — the DAG and what reads it: the voxels, the collider, the
//! merged HLOD layers — holds the baked mesh.
use super::reading::{page_data, read_primitive};
use super::{triangles, PrimitiveInputs};
use crate::compiler::pages::record::Deformation;
use crate::dag::{laid_source, DagAttributes, InputRules, MeshShaping};
use crate::displace::{bake_mesh, Baked, Piece};
use crate::Result;
use std::collections::BTreeMap;
use trillion3d_page_codec::encode::Attribute;

/// A primitive's source arrays as its build reads them: its positions, its attributes and the
/// corners of its triangles, and whether they are its mesh baked (`displace`).
pub(super) struct Source {
    pub positions: Vec<f32>,
    pub attributes: Vec<Attribute>,
    pub indices: Vec<u32>,
    pub baked: bool,
}

impl Source {
    /// The primitive's arrays as its glTF declares them.
    pub(super) fn declared(
        positions: Vec<f32>,
        attributes: Vec<Attribute>,
        indices: Vec<u32>,
    ) -> Self {
        Self {
            positions,
            attributes,
            indices,
            baked: false,
        }
    }

    /// A fallback mesh's triangles: `cover`'s, built as made like a baked mesh's.
    pub(super) fn fallback(cover: &crate::hlod::chain::SourceCover) -> Self {
        Self {
            positions: cover.positions.clone(),
            attributes: cover.carried.clone(),
            indices: cover.indices.clone(),
            baked: true,
        }
    }

    /// The baked mesh, given back where the arrays are one: what the voxels sample.
    pub(super) fn traced(self) -> Option<Baked> {
        self.baked.then_some(Baked {
            positions: self.positions,
            attributes: self.attributes,
            indices: self.indices,
        })
    }

    /// `shaping`, with the rules a baked mesh is read by: as made.
    pub(super) fn shaped(&self, shaping: MeshShaping) -> MeshShaping {
        match self.baked {
            true => MeshShaping {
                input: InputRules::as_made(),
                ..shaping
            },
            false => shaping,
        }
    }
}

/// Whether nothing of the primitive moves by itself: no skin, no morph target, no soft body.
fn rigid(deformation: &Deformation) -> bool {
    deformation.skin.is_none()
        && deformation.targets.is_empty()
        && deformation.soft_source.is_none()
}

/// `source`, replaced by its baked mesh where nothing is left of it undone: its mesh names height
/// maps (`bakes`, read now) and a trimmed error above 0, it is no skin, no morph target and no
/// soft body (`deformation`), and no placeholder of an assembly (`placeholder`), which holds no
/// triangle to read. The primitive `primitive` of source mesh `old` takes its triangles from the
/// mesh's bake, made by the first primitive of the mesh that asks.
pub(super) fn displace(
    inputs: &PrimitiveInputs<'_>,
    (old, primitive): (usize, usize),
    source: Source,
    (deformation, placeholder): (&Deformation, bool),
) -> Result<Source> {
    let named = inputs.bakes.names(old) && inputs.mesh_builds[old].trim.trimmed_error > 0.0;
    if !named || !rigid(deformation) || placeholder {
        return Ok(source);
    }
    let baked = inputs
        .bakes
        .piece((old, primitive), || bake_of_mesh(inputs, old))?;
    Ok(baked.map_or(source, |baked| Source {
        positions: baked.positions,
        attributes: baked.attributes,
        indices: baked.indices,
        baked: true,
    }))
}

/// Source mesh `old` baked: the rigid triangle primitives it holds, each as the build's input lays
/// it, tessellated as one soup and displaced, each primitive by the map of its rank
/// (`displace::bake_mesh`); the baked triangles of each, by its rank. A primitive that deforms, is
/// a placeholder or holds no triangle once laid is left out, and bakes nothing.
fn bake_of_mesh(inputs: &PrimitiveInputs<'_>, old: usize) -> Result<BTreeMap<usize, Baked>> {
    let build = &inputs.mesh_builds[old];
    let Some(settings) = inputs.bakes.of(old)? else {
        return Ok(BTreeMap::new());
    };
    let rules = (&build.input, build.drop_near_collapsed);
    let mut laid = Vec::new();
    for (index, _) in triangles::mesh_primitives(inputs.g, old)? {
        let read = read_primitive(inputs, old, index)?;
        if read.placeholder {
            continue;
        }
        let (deformation, attributes) = page_data(inputs, &read, old)?;
        if !rigid(&deformation) {
            continue;
        }
        let carried: Vec<&Attribute> = attributes.iter().collect();
        let attributes = DagAttributes { carried: &carried };
        let mesh = laid_source(&read.pos, attributes, &read.indices, rules);
        if !mesh.indices.is_empty() {
            laid.push((index, mesh));
        }
    }
    let pieces: Vec<Piece<'_>> = (laid.iter())
        .map(|(index, mesh)| Piece {
            material: *index,
            positions: &mesh.positions,
            attributes: &mesh.attributes,
            indices: &mesh.indices,
        })
        .collect();
    let baked = bake_mesh(
        inputs.bake_cap,
        &settings,
        build.trim.trimmed_error,
        &pieces,
    );
    Ok(laid.iter().map(|(index, _)| *index).zip(baked).collect())
}
