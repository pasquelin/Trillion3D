//! Lights declared by the source file, converted into the engine `SceneLight` contract.
//!
//! glTF carries them in `KHR_lights_punctual`; the ufbx importer rewrites those of
//! an FBX under that extension, so one reader serves both formats — an OBJ
//! declares none, and the cache product comes out empty. glTF is photometric
//! (candela, lux), the engine is radiometric (W/sr, W/m²): conversion is a
//! division by `LUMENS_PER_WATT`, with no spectrum assumption, and the host sets
//! exposure, never import. Detail in `docs/SDK.md`.
use super::*;
use crate::compiler_world::{world_matrices, Mat4};

mod emitter;
mod fields;
mod naming;
use emitter::Emitter;
use fields::{axis, colour_of, cone_of, number, range_of};
use naming::unique_id;

/// Luminous efficacy of photometric → radiometric conversion, in lumens per watt.
/// This is `K_cd`, the candela definition constant (683 lm/W at 540 THz). One
/// candela is therefore 1/683 W/sr and one lux 1/683 W/m². Choice published in
/// `docs/SDK.md`, not a buried constant.
const LUMENS_PER_WATT: f64 = 683.0;
/// Setting: irradiance below which a punctual light without `range` is declared
/// off, in W/m². The contract requires a finite range, glTF allows infinity:
/// `range` is `sqrt(I/threshold)`. A hundredth of a watt per square metre sits
/// under an eight-bit image floor, and keeps the range — hence the shadow map —
/// at a useful size.
const RANGE_CUTOFF_IRRADIANCE: f64 = 1e-2;
/// Maximum range, declared or deduced, in metres: beyond it, the light covers any playable scene.
const MAX_RANGE: f64 = 1.0e4;
/// Version of the `lights.json` cache product. It lives outside the manifest: its version is its own.
const SCENE_LIGHTS_VERSION: u32 = 1;
const SCENE_LIGHTS_FILE: &str = "lights.json";
/// Version of the `SceneLight` contract fulfilled by this product (`packages/sdk-core/sceneLightContracts`).
const SCENE_LIGHT_CONTRACT: u32 = 2;
const QUARTER_PI: f64 = std::f64::consts::FRAC_PI_4;
/// What one FBX intensity unit is worth in glTF's photometric unit — the only
/// place this setting is taken. FBX has no unit: its `Intensity` is a percentage,
/// which ufbx yields as a fraction. A punctual or spot takes the 1000 lm bulb in
/// 4π sr (≈ 79.6 cd per unit), a directional the illuminance of an overcast day
/// (10 000 lux).
/// Photometric intensity of glTF — candela or lux — of a radiometric quantity in
/// W/sr or W/m². Exact inverse of the division this module does on reread: a
/// driver whose format is radiometric, like `UsdLux` and Blender, goes through
/// here rather than its own factor, and the value written in the glTF returns to
/// the original watt.
pub(crate) fn photometric(radiometric: f64) -> f64 {
    radiometric * LUMENS_PER_WATT
}
pub(crate) fn fbx_intensity_scale(kind: &str) -> f64 {
    if kind == "directional" {
        10_000.0
    } else {
        1000.0 / (4.0 * std::f64::consts::PI)
    }
}
/// A glTF light placed by a world matrix, in the engine contract, or the refusal reason.
fn convert(light: &Value, m: &Mat4, id: String) -> std::result::Result<Value, &'static str> {
    if !m.iter().all(|v| v.is_finite()) {
        return Err("light-invalid-transform");
    }
    let kind = light.get("type").and_then(Value::as_str).unwrap_or("");
    if !matches!(kind, "point" | "spot" | "directional") {
        return Err("light-unsupported-type");
    }
    let radiant = number(light.get("intensity"), 1.0) / LUMENS_PER_WATT;
    if !radiant.is_finite() || radiant <= 0.0 {
        return Err("light-non-positive-intensity");
    }
    let colour = colour_of(light);
    // Shadow flag of a format that carries one (FBX) travels in `extras`; otherwise
    // an imported light casts a shadow, and the runtime per-image ceiling already bounds the cost (X5).
    let shadow = light
        .pointer("/extras/castsShadow")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let mut entry =
        json!({"id":id,"kind":kind,"color":colour,"intensity":radiant,"castsShadow":shadow});
    // A punctual light radiates everywhere: no axis, and the contract expects none.
    // The sun and the spot require one, and a matrix that flattens it refuses them.
    if kind != "point" {
        entry["direction"] = json!(axis(m).ok_or("light-degenerate-axis")?);
    }
    if kind == "directional" {
        return Ok(entry);
    }
    entry["position"] = json!([m[12], m[13], m[14]]);
    entry["range"] = json!(range_of(light, radiant, colour));
    if kind == "spot" {
        entry["coneAngle"] = json!(cone_of(light));
    }
    Ok(entry)
}
/// `rejected` counts lights left aside, `counts` what was filled or omitted on a
/// kept light: the report says where each written value comes from without taking
/// anything from the reader.
type Tally = BTreeMap<&'static str, usize>;
fn report(lights: Vec<Value>, rejected: Tally, counts: Tally) -> Value {
    json!({"version":SCENE_LIGHTS_VERSION,"sceneLightVersion":SCENE_LIGHT_CONTRACT,"units":{"lumensPerWatt":LUMENS_PER_WATT,"rangeCutoffIrradiance":RANGE_CUTOFF_IRRADIANCE,"maxRange":MAX_RANGE},"count":lights.len(),"lights":lights,"rejected":rejected,"counts":counts})
}
/// glTF lights, in the order of the nodes that instantiate them, in world space.
/// Only nodes of the rendered scene count: a light placed in another scene does
/// not light this one. A light whose type, matrix or intensity fails the contract
/// is counted in `rejected` and left aside: a compilation never dies on a light,
/// it says so.
fn scene_lights(g: &Value, bin: &[u8], scene_nodes: &BTreeSet<usize>) -> Result<Value> {
    let (mut rejected, mut counts) = (Tally::new(), Tally::new());
    let (Some(nodes), Some(declared)) = (
        g.get("nodes").and_then(Value::as_array),
        g.pointer("/extensions/KHR_lights_punctual/lights")
            .and_then(Value::as_array),
    ) else {
        return Ok(report(Vec::new(), rejected, counts));
    };
    let world = world_matrices(g)?;
    let emitter = Emitter::new(g, bin, &world)?;
    let mut seen = BTreeSet::new();
    let mut lights = Vec::new();
    for (index, node) in nodes.iter().enumerate() {
        if !scene_nodes.contains(&index) {
            continue;
        }
        let Some(slot) = node
            .pointer("/extensions/KHR_lights_punctual/light")
            .and_then(Value::as_u64)
        else {
            continue;
        };
        let Some(light) = declared.get(slot as usize) else {
            *rejected.entry("light-index-out-of-bounds").or_insert(0) += 1;
            continue;
        };
        let id = unique_id(light, node, index, &mut seen);
        match convert(light, &world[index], id) {
            Ok(mut entry) => {
                emitter.attach(&mut entry, light, index, &mut counts);
                lights.push(entry);
            }
            Err(why) => *rejected.entry(why).or_insert(0) += 1,
        }
    }
    Ok(report(lights, rejected, counts))
}
/// Compilation stage: lights come out as a cache product under their name, outside
/// the manifest. Its version therefore does not move, and a reader that ignores
/// this file reads the cache as before.
pub(super) fn stage_scene_lights(
    g: &Value,
    bin: &[u8],
    scene_nodes: &BTreeSet<usize>,
    directory: &Path,
    progress: impl Fn(Value),
) -> Result<()> {
    let lights = scene_lights(g, bin, scene_nodes)?;
    atomic(
        &directory.join(SCENE_LIGHTS_FILE),
        &serde_json::to_vec(&lights)?,
    )?;
    progress(
        json!({"phase":"lights","completed":1,"total":1,"lights":lights["count"],"rejected":lights["rejected"],"counts":lights["counts"]}),
    );
    Ok(())
}
