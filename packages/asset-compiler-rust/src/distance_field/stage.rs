//! The distance field stage, in two steps: every compiled mesh whose build asks for a field
//! (`distanceField`, `distanceFieldScale` above 0) has its field built from the level-0 triangles
//! of the source mesh it is read from (`build_mesh_fields`); the fields of the HLOD cells whose
//! layer allows one (`actors.rs`) are built with the world's actors, which come after; and all are
//! written in one product, `distanceFields.bin`, which the manifest's `distanceFields` section
//! names (`write_distance_fields`). A scene whose meshes and HLOD cells build none writes neither.
use super::abi::DISTANCE_FIELD_FILE;
use super::abi::DISTANCE_FIELD_UNITS_PER_METRE;
use super::build::build;
use super::encode::{add_parts, encode, report, Owner, Placed};
use super::grid::bound_voxels;
use super::scene::Scene;
use super::DistanceFieldSettings;
use crate::compiler::cache::storage::{product, Product};
use crate::compiler::primitive::triangles::mesh_primitives;
use crate::trace::surface::mesh::Corners;
use crate::Result;
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use trillion3d_page_codec::proxy::bvh::Node;
use trillion3d_page_codec::proxy::PROXY_LEAF_TRIANGLES;

/// What the stage reads: the scene, its meshes' map, and how each source mesh's field is built
/// (its build's) — no texture: the field starts beside them (`compiler/build/stages.rs`).
pub(crate) struct DistanceFieldInputs<'a> {
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub mesh_map: &'a BTreeMap<usize, usize>,
    pub settings: &'a [DistanceFieldSettings],
    /// The compilation's cancel: the fields run beside the textures and stop with them.
    pub cancelled: &'a AtomicBool,
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

/// The compiled meshes that ask for a field, each with the source mesh it is read from.
fn asked(inputs: &DistanceFieldInputs<'_>) -> Vec<(usize, usize)> {
    (source_meshes(inputs.mesh_map).into_iter())
        .filter(|&(_, source)| {
            inputs
                .settings
                .get(source)
                .is_some_and(DistanceFieldSettings::builds)
        })
        .collect()
}

/// Bytes a triangle takes while its field is built: read (its nine floats, its tag, its
/// corners), in centimetres and in the tree's soup (nine floats each), its rank kept, the tree's
/// tag and leaf order, its two-sided flag, its share of the tree's nodes — at most two a half-full
/// leaf —, and packed for the device (`gpu::PACKED_TRIANGLE_BYTES`).
const TRIANGLE_BYTES: usize = 9 * 4
    + 4
    + size_of::<Corners>()
    + 2 * 9 * 4
    + size_of::<usize>()
    + 4
    + size_of::<usize>()
    + 1
    + (2 * size_of::<Node>()).div_ceil(PROXY_LEAF_TRIANGLES / 2)
    + super::gpu::PACKED_TRIANGLE_BYTES;

/// The triangles of mesh `mesh` of `g`: each primitive's corners — its indices, or its vertices
/// when it has none — as its mode draws them, a strip's or a fan's two fewer than its corners, a
/// list's a third of them, none for points and lines.
fn triangle_count(g: &Value, mesh: usize) -> Result<usize> {
    let count = |id: Option<&Value>| {
        (id.and_then(Value::as_u64))
            .and_then(|id| g.pointer(&format!("/accessors/{id}/count")))
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize
    };
    Ok(mesh_primitives(g, mesh)?
        .map(|(_, primitive)| {
            let corners = match primitive.get("indices") {
                Some(indices) => count(Some(indices)),
                None => count(primitive.pointer("/attributes/POSITION")),
            };
            match primitive.get("mode").and_then(Value::as_u64).unwrap_or(4) {
                4 => corners / 3,
                5 | 6 => corners.saturating_sub(2),
                _ => 0,
            }
        })
        .sum())
}

/// The box of mesh `mesh` of `g` in the field's unit, from its primitives' `POSITION` bounds, which
/// glTF requires; none when one lacks them.
fn mesh_bounds(g: &Value, mesh: usize) -> Result<Option<([f64; 3], [f64; 3])>> {
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for (_, primitive) in mesh_primitives(g, mesh)? {
        let accessor = (primitive
            .pointer("/attributes/POSITION")
            .and_then(Value::as_u64))
        .and_then(|id| g.pointer(&format!("/accessors/{id}")));
        let corner = |name: &str| -> Option<[f64; 3]> {
            let values = accessor?.get(name)?.as_array()?;
            let at = |k: usize| values.get(k).and_then(Value::as_f64);
            Some([at(0)?, at(1)?, at(2)?].map(|v| v * DISTANCE_FIELD_UNITS_PER_METRE))
        };
        let (Some(min), Some(max)) = (corner("min"), corner("max")) else {
            return Ok(None);
        };
        for k in 0..3 {
            (low[k], high[k]) = (low[k].min(min[k]), high[k].max(max[k]));
        }
    }
    Ok(low[0].is_finite().then_some((low, high)))
}

/// What building the fields of `inputs` holds at most beside the textures, which run with them
/// (`compiler/build/stages.rs`), every mesh at once: its triangles as they are read, copied and
/// packed (`TRIANGLE_BYTES`) and every voxel its mips could hold measured (`grid::bound_voxels`);
/// and the device's batches, one mesh's at a time (`gpu.rs`, `ONE_MESH`), the largest; nothing
/// when no mesh asks for a field.
pub(crate) fn working_bytes(inputs: &DistanceFieldInputs<'_>) -> Result<usize> {
    let (mut held, mut batches) = (0usize, 0usize);
    for (_, source) in asked(inputs) {
        let settings = &inputs.settings[source];
        let voxels = bound_voxels(mesh_bounds(inputs.g, source)?, settings);
        let triangles = triangle_count(inputs.g, source)?;
        held = held
            .saturating_add(triangles.saturating_mul(TRIANGLE_BYTES))
            .saturating_add(voxels.saturating_mul(super::gpu::VOXEL_BYTES));
        batches = batches.max(super::gpu::batch_bytes(voxels));
    }
    Ok(held.saturating_add(batches))
}

/// The field of every compiled mesh that asks for one, in the order of the meshes.
pub(crate) fn build_mesh_fields(inputs: &DistanceFieldInputs<'_>) -> Result<Vec<Placed>> {
    let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::DistanceFields);
    let asked = asked(inputs);
    let built: Vec<Option<Placed>> = asked
        .par_iter()
        .map(|&(compiled, source)| {
            let read = (inputs.g, inputs.bin);
            let two_sided = inputs.settings[source].as_if_two_sided;
            let Some(scene) = Scene::read(read, source, (two_sided, false))? else {
                return Ok(None);
            };
            let field = build(&scene, &inputs.settings[source], inputs.cancelled)?;
            Ok(Some(Placed {
                owner: Owner::Mesh(compiled as u32),
                field,
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
