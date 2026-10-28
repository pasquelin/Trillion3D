//! Lights declared by the source file, converted into the engine `SceneLight` contract.
//!
//! glTF carries them in `KHR_lights_punctual`; the ufbx importer rewrites those of
//! an FBX under that extension, so one reader serves both formats — an OBJ
//! declares none, and the cache product comes out empty. glTF intensities are candela
//! and lux, and the engine takes them as the same numbers, with no luminous efficacy
//! between them: the host sets exposure, never import. Detail in `docs/SDK.md`.
use crate::compiler::source::node_transform::Mat4;
use crate::light_profile::Profiles;
use crate::*;

mod emitter;
mod fields;
mod naming;
use emitter::attach;
use fields::{attach_shadow_distance, colour_of, cone_of, range_of};
pub(crate) use fields::{axis, up_axis};
use naming::unique_id;

/// Range, in metres, of a punctual light that declares none: glTF gives it no end. A finite number
/// the runtime reads as a radius that covers every cell of the light grid.
const UNBOUNDED_RANGE: f64 = 1.0e20;
/// Version of the `lights.json` cache product. It lives outside the manifest: its version is its own.
/// 4 gives a light without range an unbounded one (1e20 m) and drops the `units` block; 3 names a spot's cones `innerConeAngle` and `outerConeAngle` and a lamp's unit `candelas`; 2
/// writes the intensities as the source declares them, in candela and lux; 1 divided them by 683.
const SCENE_LIGHTS_VERSION: u32 = 4;
const SCENE_LIGHTS_FILE: &str = "lights.json";
/// Version of the `SceneLight` contract fulfilled by this product (`packages/sdk-core/sceneLightContracts`).
/// 4 reads a lamp that names no unit as unitless, and a spot's opening as an inner and an outer
/// cone: the records written here name their unit, `candelas`, and both cones. 3 gave a lamp's
/// intensity a unit, candelas when it named none.
const SCENE_LIGHT_CONTRACT: u32 = 4;
const QUARTER_PI: f64 = std::f64::consts::FRAC_PI_4;
/// The open interval of a spot's half-angle the `SceneLight` contract accepts, the one clamp
/// every importer's cone goes through (`fields::cone_of`): a milliradian off a point and off a
/// half-space.
const SPOT_CONE_MIN: f64 = 1e-3;
const SPOT_CONE_MAX: f64 = std::f64::consts::FRAC_PI_2 - SPOT_CONE_MIN;
/// The intensity of a source whose format is radiometric, like `UsdLux` and Blender: its `value`
/// raised by `exposure` stops and times the format's `factor` (area, spread), grouped
/// `(value · 2^exposure) · factor`. The glTF written from it carries that number, and the
/// engine reads it back unchanged.
pub(crate) fn radiometric_intensity(value: f64, exposure: f64, factor: f64) -> f64 {
    value * exposure.exp2() * factor
}

/// What one FBX intensity unit is worth in glTF's photometric unit — the only
/// place this setting is taken. FBX has no unit: its `Intensity` is a percentage,
/// which ufbx yields as a fraction. A punctual or spot takes the 1000 lm bulb in
/// 4π sr (≈ 79.6 cd per unit), a directional the illuminance of an overcast day
/// (10 000 lux).
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
    let intensity = crate::compiler::validate::number_or(light.get("intensity"), 1.0);
    if !intensity.is_finite() || intensity < 0.0 {
        return Err("light-negative-intensity");
    }
    let colour = colour_of(light);
    // Shadow flag of a format that carries one (FBX) travels in `extras`; otherwise
    // an imported light casts a shadow, and the runtime per-image ceiling already bounds the cost.
    let shadow = light
        .pointer("/extras/castsShadow")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let mut entry =
        json!({"id":id,"kind":kind,"color":colour,"intensity":intensity,"castsShadow":shadow});
    // A lamp's intensity is candela in the glTF; a sun's is lux, which names no unit.
    if kind != "directional" {
        entry["intensityUnits"] = json!("candelas");
    }
    // A punctual light radiates everywhere: no axis, and the contract expects none.
    // The sun and the spot require one, and a matrix that flattens it refuses them.
    if kind != "point" {
        entry["direction"] = json!(axis(m).ok_or("light-degenerate-axis")?);
    }
    if kind == "directional" {
        return Ok(entry);
    }
    entry["position"] = json!([m[12], m[13], m[14]]);
    entry["range"] = json!(range_of(light));
    if kind == "spot" {
        let (inner, outer) = cone_of(light);
        entry["innerConeAngle"] = json!(inner);
        entry["outerConeAngle"] = json!(outer);
    }
    Ok(entry)
}
/// `rejected` counts lights left aside, `counts` what was filled or omitted on a
/// kept light: the report says where each written value comes from without taking
/// anything from the reader.
pub(crate) type Tally = BTreeMap<&'static str, usize>;
fn report(lights: Vec<Value>, rejected: Tally, counts: Tally) -> Value {
    json!({"version":SCENE_LIGHTS_VERSION,"sceneLightVersion":SCENE_LIGHT_CONTRACT,"count":lights.len(),"lights":lights,"rejected":rejected,"counts":counts})
}
/// The rendered scene's nodes, and those a hidden node hides (`source/nodes.rs`, `scene_nodes`).
type Nodes<'a> = (&'a BTreeSet<usize>, &'a BTreeSet<usize>);
/// glTF lights, in the order of the nodes that instantiate them, in world space.
/// Only nodes of the rendered scene count: a light placed in another scene does
/// not light this one, nor one a hidden node hides (`KHR_node_visibility`). A
/// light whose type, matrix or intensity fails the contract is counted in
/// `rejected` and left aside: a compilation never dies on a light, it says so. `world` is every
/// node's transform, computed once for the job (`proxy::placement::Placement`).
fn scene_lights(
    (g, world): (&Value, &[Mat4]),
    (reached, hidden): Nodes<'_>,
    profiles: &mut Profiles<'_>,
) -> Result<Value> {
    let (mut rejected, mut counts) = (Tally::new(), Tally::new());
    let (Some(nodes), Some(declared)) = (
        g.get("nodes").and_then(Value::as_array),
        g.pointer("/extensions/KHR_lights_punctual/lights")
            .and_then(Value::as_array),
    ) else {
        return Ok(report(Vec::new(), rejected, counts));
    };
    let mut seen = BTreeSet::new();
    let mut lights = Vec::new();
    for (index, node) in nodes.iter().enumerate() {
        if !reached.contains(&index) || hidden.contains(&index) {
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
                attach_shadow_distance(&mut entry, light, &mut counts);
                attach(&mut entry, light, &mut counts);
                profiles.attach(&mut entry, light, &world[index], &mut counts)?;
                lights.push(entry);
            }
            Err(why) => *rejected.entry(why).or_insert(0) += 1,
        }
    }
    Ok(report(lights, rejected, counts))
}
/// Compilation stage: lights come out as a cache product under their name, outside
/// the manifest, and as the document the bake of the volumetric lightmap reads. Its version
/// therefore does not move, and a reader that ignores this file reads the cache unchanged.
pub(crate) fn stage_scene_lights(
    scene: (&Value, &[Mat4]),
    scene_nodes: Nodes<'_>,
    directory: &Path,
    image_root: &Path,
    progress: impl Fn(Value),
) -> Result<(Product, Vec<Product>, Value)> {
    let mut profiles = Profiles::new(image_root, directory);
    let lights = scene_lights(scene, scene_nodes, &mut profiles)?;
    let written = product(directory, SCENE_LIGHTS_FILE, &serde_json::to_vec(&lights)?)?;
    progress(lights_event(&lights));
    Ok((written, profiles.into_products(), lights))
}

/// The `lights` event: how many lights were kept, and the reasons the others were left out.
fn lights_event(lights: &Value) -> Value {
    json!({"phase":"lights","completed":1,"total":1,"lights":lights["count"],"rejected":lights["rejected"],"counts":lights["counts"]})
}

/// The `lights` event of the `lights.json` a proven folder keeps, told again when it is reused.
pub(crate) fn stored_lights_event(directory: &Path) -> Option<Value> {
    let lights: Value =
        serde_json::from_slice(&fs::read(directory.join(SCENE_LIGHTS_FILE)).ok()?).ok()?;
    Some(lights_event(&lights))
}
