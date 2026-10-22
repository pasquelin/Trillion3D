//! The volumetric lightmap stage: the bake of a job that asks for one (`lightmapBake`), its layers
//! written in one product, `volumetric-lightmap.bin`, which the manifest's `volumetricLightmap`
//! section names. A job that asks for none, or a scene with no surface to light, writes neither.
use super::bake::abi::LIGHTMAP_BAKE_FILE;
use super::bake::{bake, BakeInputs, SceneInputs};
use super::encode;
use super::format::VOLUMETRIC_LIGHTMAP_VERSION;
use crate::compiler::args::LightmapBakeOptions;
use crate::compiler::cache::storage::{product, Product};
use crate::{CompilerError, Result};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::AtomicBool;

/// What the stage reads: the job's bake, the scene, its lights (`lights.json`) and the token the
/// job is cancelled by.
pub(crate) struct LightmapInputs<'a> {
    pub options: &'a LightmapBakeOptions,
    pub scene: SceneInputs<'a>,
    pub lights: &'a Value,
    pub cancelled: &'a AtomicBool,
}

/// Bakes the scene and writes `volumetric-lightmap.bin` in `directory`; returns its product and the
/// manifest's `volumetricLightmap` section, none when the job asks for no bake or the scene holds
/// nothing to bake.
pub(crate) fn stage_volumetric_lightmap(
    inputs: LightmapInputs<'_>,
    directory: &Path,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Option<(Product, Value)>> {
    let Some(settings) = inputs.options.settings() else {
        return Ok(None);
    };
    let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::VolumetricLightmap);
    let bake_inputs = BakeInputs {
        scene: inputs.scene,
        lights: inputs.lights,
        cancelled: inputs.cancelled,
    };
    let Some((layers, mut section)) = bake(&bake_inputs, settings, progress)? else {
        return Ok(None);
    };
    let bytes =
        encode(&layers).map_err(|message| CompilerError::new("INVALID_LIGHTMAP", message))?;
    let written = product(directory, LIGHTMAP_BAKE_FILE, &bytes)?;
    section["version"] = json!(VOLUMETRIC_LIGHTMAP_VERSION);
    section["file"] = json!(LIGHTMAP_BAKE_FILE);
    section["bytes"] = json!(bytes.len());
    section["bounds"] = json!([layers.bounds.0, layers.bounds.1]);
    Ok(Some((written, section)))
}
