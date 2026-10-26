//! The distance field stage, in two steps: every compiled mesh whose build asks for a field
//! (`distanceField`, `distanceFieldScale` above 0) has its field built from the level-0 triangles
//! of the source mesh it is read from (`build_mesh_fields`); the fields of the HLOD cells whose
//! layer allows one (`actors.rs`) are built with the world's actors, which come after; and all are
//! written in one product, `distanceFields.bin`, which the manifest's `distanceFields` section
//! names (`write_distance_fields`). A scene whose meshes and HLOD cells build none writes neither.
use super::abi::DISTANCE_FIELD_FILE;
use super::build::build;
use super::encode::{add_parts, encode, report, Owner, Placed};
use super::scene::Scene;
use super::DistanceFieldSettings;
use crate::compiler::cache::storage::{product, Product};
use crate::texture::TexturePreview;
use crate::Result;
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

/// What the stage reads: the scene, its previews, its meshes' map, and how each source mesh's
/// field is built (its build's).
pub(crate) struct DistanceFieldInputs<'a> {
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub previews: &'a [TexturePreview],
    pub mesh_map: &'a BTreeMap<usize, usize>,
    pub settings: &'a [DistanceFieldSettings],
}

/// The source mesh each compiled mesh is read from — the first it stands for —, by compiled mesh:
/// what a mesh's representations (its field, its cards) are built from.
pub(crate) fn source_meshes(mesh_map: &BTreeMap<usize, usize>) -> BTreeMap<usize, usize> {
    let mut source_of: BTreeMap<usize, usize> = BTreeMap::new();
    for (&source, &compiled) in mesh_map {
        source_of.entry(compiled).or_insert(source);
    }
    source_of
}

/// The field of every compiled mesh that asks for one, in the order of the meshes.
pub(crate) fn build_mesh_fields(inputs: &DistanceFieldInputs<'_>) -> Result<Vec<Placed>> {
    let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::DistanceFields);
    let asked: Vec<(usize, usize)> = (source_meshes(inputs.mesh_map).into_iter())
        .filter(|&(_, source)| {
            inputs
                .settings
                .get(source)
                .is_some_and(DistanceFieldSettings::builds)
        })
        .collect();
    let built: Vec<Option<Placed>> = asked
        .par_iter()
        .map(|&(compiled, source)| {
            let read = (inputs.g, inputs.bin, inputs.previews);
            let two_sided = inputs.settings[source].as_if_two_sided;
            let scene = Scene::read(read, source, (two_sided, false))?;
            Ok(scene.map(|scene| Placed {
                owner: Owner::Mesh(compiled as u32),
                field: build(&scene, &inputs.settings[source]),
            }))
        })
        .collect::<Result<_>>()?;
    Ok(built.into_iter().flatten().collect())
}

/// Writes `fields` as `distanceFields.bin` in `directory`; returns its product and the manifest's
/// `distanceFields` section, none when there is no field.
pub(crate) fn write_distance_fields(
    fields: &[Placed],
    directory: &Path,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Option<(Product, Value)>> {
    if fields.is_empty() {
        return Ok(None);
    }
    let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::DistanceFields);
    let bytes = encode(fields);
    let written = product(directory, DISTANCE_FIELD_FILE, &bytes)?;
    let mut section = report(fields, bytes.len());
    add_parts(&mut section, &bytes);
    let on_cpu: Vec<&str> = (fields.iter())
        .filter_map(|placed| placed.field.on_cpu.as_deref())
        .collect();
    progress(json!({"phase":"distanceFields","completed":1,"total":1,
        "meshes":fields.len(),"bricks":section["bricks"],
        "onCpu":on_cpu.len(),"onCpuReason":on_cpu.first(),
        "remeasured":fields.iter().map(|placed| placed.field.remeasured).sum::<usize>()}));
    Ok(Some((written, section)))
}
