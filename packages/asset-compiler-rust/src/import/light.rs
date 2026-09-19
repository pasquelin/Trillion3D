//! The light every driver writes, whichever format was read.
//!
//! The only light contract the compiler knows how to reread is `KHR_lights_punctual`:
//! an entry in `extensions.KHR_lights_punctual.lights`, and a node that cites it.
//! Each driver reads its own source — a `ufbx::Light`, a `UsdLux` prim, an SDNA
//! `Lamp` block — and only has to fill this structure: the glTF is written here,
//! once, so one more format does not reinvent the document shape.
//!
//! **Units.** `intensity` is photometric, as glTF requires: candelas for a
//! punctual and a spot, lux for a directional. It is the driver's job to convert
//! its format's unit, and to say which; `compiler_lights` then redivides by
//! `LUMENS_PER_WATT`. `emitter_radius` is in world metres, like the rest of the scene.
use super::*;

/// A light read from a source, before it becomes glTF.
pub(crate) struct LightSource {
    pub(crate) name: String,
    /// `point`, `directional` or `spot`: the only three `KHR_lights_punctual` types.
    pub(crate) kind: &'static str,
    pub(crate) colour: [f64; 3],
    /// Candelas for a punctual and a spot, lux for a directional.
    pub(crate) intensity: f64,
    /// Inner and outer half-angles of a spotlight, in radians.
    pub(crate) cone: Option<(f64, f64)>,
    /// Shadow flag of formats that carry one; absent when the source says nothing,
    /// and the compiler then lets the light cast its shadow.
    pub(crate) casts_shadow: Option<bool>,
    /// Radius of the emissive envelope the source declares, in world metres.
    pub(crate) emitter_radius: Option<f64>,
}

impl LightSource {
    /// The `KHR_lights_punctual` entry of this light. What the source does not
    /// carry stays absent: no field is invented in its place.
    pub(crate) fn json(&self) -> Value {
        let mut light = json!({
            "name": self.name, "type": self.kind,
            "color": self.colour, "intensity": self.intensity,
        });
        if let Some((inner, outer)) = self.cone {
            light["spot"] = json!({"innerConeAngle": inner, "outerConeAngle": outer});
        }
        let mut extras = serde_json::Map::new();
        if let Some(shadow) = self.casts_shadow {
            extras.insert("castsShadow".into(), json!(shadow));
        }
        if let Some(radius) = self.emitter_radius {
            extras.insert("emitterRadius".into(), json!(radius));
        }
        if !extras.is_empty() {
            light["extras"] = Value::Object(extras);
        }
        light
    }
}

/// The two half-angles of a spotlight, in radians, from the OUTER half-angle and
/// the fraction of the cone that softens toward its edge. Each format names and
/// frames these two numbers its own way — `inputs:shaping:cone:angle` and its
/// `softness` in `UsdLux`, `spotsize` (the full angle) and `spotblend` in Blender
/// — but the rule that draws the inner from them is the same, and it is written
/// only here. Softness is clamped to `[0, 1]`: outside that, the cone would invert.
pub(crate) fn cone_angles(outer: f64, softness: f64) -> (f64, f64) {
    (outer * (1.0 - softness.clamp(0.0, 1.0)), outer)
}

/// What a node carries to cite the light of rank `light`: the glTF extension
/// shape, written once for drivers that build their node themselves as for `light_node`.
pub(crate) fn light_extension(light: usize) -> Value {
    json!({"KHR_lights_punctual": {"light": light}})
}

/// The node that instantiates the light of rank `light`, at the given matrix.
pub(crate) fn light_node(name: &str, matrix: Value, light: usize) -> Value {
    json!({"name": name, "matrix": matrix, "extensions": light_extension(light)})
}

/// Declares lights in the document. A scene that carries none does not announce
/// the extension: its document stays the one it wrote before this path existed.
pub(crate) fn attach_lights(gltf: &mut Value, lights: &[Value]) {
    if lights.is_empty() {
        return;
    }
    gltf["extensions"] = json!({"KHR_lights_punctual": {"lights": lights}});
    gltf["extensionsUsed"] = json!(["KHR_lights_punctual"]);
}
