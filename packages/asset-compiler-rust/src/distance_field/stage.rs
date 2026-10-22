//! The distance field stage: every compiled mesh whose build asks for a field (`distanceField`,
//! `distanceFieldScale` above 0), its field built from the level-0 triangles of the source mesh it
//! is read from and the fields written in one product, `distanceFields.bin`, which the manifest's
//! `distanceFields` section names. A scene whose meshes build none writes neither.
use super::abi::DISTANCE_FIELD_FILE;
use super::build::build;
use super::encode::{encode, report, Placed};
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

/// Builds every asked field and writes `distanceFields.bin` in `directory`; returns its product and
/// the manifest's `distanceFields` section, none when no mesh asks for a field.
pub(crate) fn stage_distance_fields(
    inputs: &DistanceFieldInputs<'_>,
    directory: &Path,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Option<(Product, Value)>> {
    let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::DistanceFields);
    // A compiled mesh is read from the first source mesh it stands for.
    let mut source_of: BTreeMap<usize, usize> = BTreeMap::new();
    for (&source, &compiled) in inputs.mesh_map {
        source_of.entry(compiled).or_insert(source);
    }
    let asked: Vec<(usize, usize)> = (source_of.into_iter())
        .filter(|&(_, source)| {
            inputs
                .settings
                .get(source)
                .is_some_and(DistanceFieldSettings::builds)
        })
        .collect();
    if asked.is_empty() {
        return Ok(None);
    }
    let built: Vec<Option<Placed>> = asked
        .par_iter()
        .map(|&(compiled, source)| {
            let read = (inputs.g, inputs.bin, inputs.previews);
            let scene = Scene::read(read, source, inputs.settings[source].as_if_two_sided)?;
            Ok(scene.map(|scene| Placed {
                mesh: compiled as u32,
                field: build(&scene, &inputs.settings[source]),
            }))
        })
        .collect::<Result<_>>()?;
    let fields: Vec<Placed> = built.into_iter().flatten().collect();
    if fields.is_empty() {
        return Ok(None);
    }
    let bytes = encode(&fields);
    let written = product(directory, DISTANCE_FIELD_FILE, &bytes)?;
    let section = report(&fields, bytes.len());
    progress(json!({"phase":"distanceFields","completed":1,"total":1,
        "meshes":fields.len(),"bricks":section["bricks"]}));
    Ok(Some((written, section)))
}
