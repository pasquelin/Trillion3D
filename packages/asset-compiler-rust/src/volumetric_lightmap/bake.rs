//! The bake of a volumetric lightmap: the indirect light of a scene, traced on the CPU by the
//! algorithm the reference's GPU bake runs, and laid out as the file `format.rs` describes.
//!
//! The steps, in order:
//! 1. the importance boxes — the ones the job names, else the scene's box grown, cut to a cube
//!    when it is too large (`volumes`, `automaticVolumeExpand`, `automaticVolumeLimit`);
//! 2. the layout (`layout.rs`): the bricks the geometry asks for, at `maxRefinementLevels` levels
//!    of `detailCellSize` cells, voxelised by `voxelize.rs`;
//! 3. the probes (`probe.rs`): every brick's 4³ samples, `giSamples × qualityMultiplier` passes
//!    (and the irradiance cache's, `irradiance.rs`), each pass a path in the two hemispheres
//!    of a probe (`kernel.rs`, `nee.rs`), its numbers drawn from a scrambled Sobol' sequence
//!    seeded by the probe's place (`random.rs`) — a bake is the same at every run;
//! 4. the stitching (`stitch.rs`) and the file's layers (`mod.rs`).
//!
//! Missing inputs, bounds of this bake: the sky light — the compile job holds no sky radiance, so
//! the sky gives no light and the bent normal layer is left out; translucent surfaces, which let
//! everything through; the alpha of a masked material's texture, which is not read; a light's
//! `emitterLength`, a point or spot being a sphere.
pub mod abi;
mod accumulate;
mod irradiance;
mod kernel;
mod layout;
mod lights;
mod nee;
mod probe;
mod random;
mod sampling;
mod settings;
mod stitch;
mod store;
mod voxelize;
mod world;

pub use settings::BakeSettings;
pub use world::SceneInputs;

use super::VolumetricLightmapLayers;
use crate::Result;
use layout::{union, Layout};
use sampling::Vec3;
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;
use store::Store;
use trillion3d_math::vector::vecn::length;

/// Passes between two progress events.
const PROGRESS_PASSES: u32 = 16;

/// What a bake reads besides its settings.
pub struct BakeInputs<'a> {
    pub scene: SceneInputs<'a>,
    /// The scene's lights (`lights.json`).
    pub lights: &'a Value,
    pub cancelled: &'a AtomicBool,
}

/// The importance boxes of a scene whose instances' box is `scene`.
fn importance_boxes(settings: &BakeSettings, scene: (Vec3, Vec3)) -> Vec<(Vec3, Vec3)> {
    if !settings.volumes.is_empty() {
        return settings.volumes.clone();
    }
    let (low, high) = scene;
    let half = [0, 1, 2].map(|k| (high[k] - low[k]) / 2.0);
    let limit = settings.automatic_volume_limit;
    if length(half) > limit {
        let centre = [0, 1, 2].map(|k| (low[k] + high[k]) / 2.0);
        return vec![(centre.map(|c| c - limit), centre.map(|c| c + limit))];
    }
    let grow = settings.automatic_volume_expand;
    vec![(low.map(|c| c - grow), high.map(|c| c + grow))]
}

/// The triangles of the instances the voxelisation draws, those whose box meets an importance box.
fn drawn_triangles(
    instances: &[world::Instance],
    materials: &world::Materials,
    boxes: &[(Vec3, Vec3)],
) -> Vec<f32> {
    let meets = |(low, high): (Vec3, Vec3)| {
        boxes
            .iter()
            .any(|(a, b)| (0..3).all(|k| low[k] <= b[k] && high[k] >= a[k]))
    };
    let mut out = Vec::new();
    for instance in instances.iter().filter(|i| meets(i.bounds())) {
        for (corners, &slot) in instance
            .triangles
            .as_chunks::<9>()
            .0
            .iter()
            .zip(&instance.slots)
        {
            if materials.draws(slot) {
                out.extend_from_slice(corners);
            }
        }
    }
    out
}

/// The file's layers of a baked store.
fn layers_of(layout: &Layout, store: Store) -> VolumetricLightmapLayers {
    let bytes = |texels: &[[u8; 4]]| texels.iter().flatten().copied().collect::<Vec<u8>>();
    let high = [0, 1, 2].map(|k| layout.volume_min[k] + layout.volume_size[k]);
    VolumetricLightmapLayers {
        bounds: (layout.volume_min.map(|c| c as f32), high.map(|c| c as f32)),
        brick_size: settings::BRICK_SIZE,
        indirection_dimensions: layout.indirection_dims,
        brick_dimensions: store.dims.map(|d| d as u32),
        indirection: layout.indirection.iter().flatten().copied().collect(),
        ambient: store.ambient.iter().flat_map(|a| a.to_le_bytes()).collect(),
        coefficients: std::array::from_fn(|k| bytes(&store.coefficients[k])),
        sky_bent_normal: Vec::new(),
        directional_shadowing: store.shadowing,
    }
}

/// Traces every brick of `scene`'s layout, batch after batch, then stitches the atlas.
fn trace_volume(
    scene: &probe::Scene<'_>,
    (cancelled, progress): (&AtomicBool, &(impl Fn(Value) + Sync)),
) -> Result<Store> {
    let layout = scene.layout;
    let mut store = Store::new(std::array::from_fn(|a| {
        (layout.layout_dims[a] * layout::PADDED) as usize
    }));
    let mut cache = probe::new_cache(scene.settings);
    let count = layout.bricks.len();
    let passes = scene.settings.total_passes();
    let batches = count.div_ceil(probe::BATCH_BRICKS) as u32;
    for (batch, start) in (0..count).step_by(probe::BATCH_BRICKS).enumerate() {
        let range = start..(start + probe::BATCH_BRICKS).min(count);
        let passed = |frame: u32| {
            if frame % PROGRESS_PASSES == PROGRESS_PASSES - 1 || frame + 1 == passes {
                let done = batch as u32 * passes + frame + 1;
                let total = batches * passes;
                progress(json!({"phase":"volumetricLightmap","completed":done,"total":total}));
            }
        };
        probe::bake_batch(scene, &mut cache, range, (&mut store, cancelled, &passed))?;
    }
    stitch::stitch(layout, &mut store);
    Ok(store)
}

/// Bakes the scene: the layers of its volumetric lightmap and the report of what was baked, none
/// when the scene has no surface or the volume asks for no brick.
pub fn bake(
    inputs: &BakeInputs<'_>,
    settings: &BakeSettings,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Option<(VolumetricLightmapLayers, Value)>> {
    let materials = world::Materials::of(&inputs.scene);
    let instances = world::instances(&inputs.scene, &materials)?;
    let boxes: Vec<_> = instances.iter().map(world::Instance::bounds).collect();
    let scene_box = union(&boxes);
    let boxes = importance_boxes(settings, scene_box);
    let triangles = drawn_triangles(&instances, &materials, &boxes);
    let Some(world) = world::BakeWorld::build(instances, &materials) else {
        return Ok(None);
    };
    let Some(layout) = Layout::build(settings, &boxes, &triangles) else {
        return Ok(None);
    };
    let lights = lights::read_lights(inputs.lights);
    let volume = (
        layout.volume_min,
        std::array::from_fn(|k| layout.volume_min[k] + layout.volume_size[k]),
    );
    let (low, high) = union(&[scene_box, volume]);
    let scene = probe::Scene {
        layout: &layout,
        settings,
        world: &world,
        lights: &lights,
        reach: length(std::array::from_fn::<f64, 3, _>(|k| high[k] - low[k])) * 2.0,
    };
    let store = trace_volume(&scene, (inputs.cancelled, progress))?;
    let report = json!({
        "bricks": layout.bricks.len(), "levels": layout.levels.len(),
        "indirection": layout.indirection_dims, "passes": settings.total_passes(), "sky": false,
    });
    Ok(Some((layers_of(&layout, store), report)))
}
