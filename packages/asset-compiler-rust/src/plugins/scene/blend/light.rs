//! Lamps of a Blender file: the `Lamp` block a lamp-type object designates, to
//! `KHR_lights_punctual`. As everywhere in this driver, each field is asked for **by its name**
//! from the file's SDNA, never from a hardcoded offset.
//!
//! **What is read.** The four types Blender writes today: point, sun, spot, and area — glTF
//! having no extended source, an area becomes a point that its emitter radius clothes. Any other
//! type is counted and left aside.
//!
//! **Units.** Blender is radiometric: a lamp's power is in watts, a sun's strength in watts per
//! square metre, and exposure multiplies it by `2^exposure`. The radiant intensity of a point or
//! a spot is therefore `P / 4π` W/sr — Blender spreads a spot's power over the whole sphere, the
//! cone only cuts it —, that of a lambertian area `P / π` on axis, and a sun's illuminance is
//! its strength as-is. glTF being photometric, `compiler_lights::photometric` does the
//! conversion, and rereading it yields exactly the watt read here.
//!
//! **The emitter radius** comes from the native data: `radius` — `shadow_soft_size` in files that
//! still name it that way — for a point and a spot, the half-diagonal or half-diameter of the
//! emissive surface for an area lamp. It is carried in world metres by the object's scale. A sun
//! receives none: the engine contract refuses any envelope to a lamp that has neither centre nor
//! range.
use super::*;

/// The object type that holds a lamp.
pub(super) const OB_LAMP: i64 = 10;
/// Blender lamp types: point, sun, spot, area.
const LA_LOCAL: i64 = 0;
const LA_SUN: i64 = 1;
const LA_SPOT: i64 = 2;
const LA_AREA: i64 = 4;
/// Shapes of an area lamp: square, rectangle, disk, ellipse.
const LA_AREA_SQUARE: i64 = 0;
const LA_AREA_DISK: i64 = 4;
const LA_AREA_ELLIPSE: i64 = 5;
/// A lamp type a file writes without this driver knowing how to convert it — the `hemi` of
/// files from before Blender 2.8, among others.
const UNSUPPORTED: &str = "blend-light-type-unsupported";
/// A lamp-type object whose data is not a `Lamp` block, or is nothing.
const MISSING: &str = "blend-lamp-missing";

/// The glTF lamp of a lamp-type object, or nothing when this driver does not convert it. `scale`
/// is the object's world scale: it is what puts the emitter radius in metres.
pub(super) fn build(
    lamp: Option<At<'_>>,
    name: String,
    scale: f64,
    out: &mut Out,
) -> Option<usize> {
    let Some(lamp) = lamp.filter(|data| data.layout.name == "Lamp") else {
        out.report.add(MISSING);
        return None;
    };
    let kind = lamp.int("type", -1);
    let (gltf_kind, cone) = match kind {
        LA_LOCAL | LA_AREA => ("point", None),
        LA_SUN => ("directional", None),
        LA_SPOT => ("spot", Some(cone(&lamp))),
        _ => {
            out.report.add(UNSUPPORTED);
            return None;
        }
    };
    let power = f64::from(energy(&lamp)) * f64::from(lamp.float("exposure", 0.0)).exp2();
    let source = crate::import::LightSource {
        name,
        kind: gltf_kind,
        colour: [
            lamp.float("r", 1.0),
            lamp.float("g", 1.0),
            lamp.float("b", 1.0),
        ]
        .map(|channel| f64::from(channel).max(0.0)),
        intensity: crate::compiler_lights::photometric(power * spread(kind)),
        cone,
        casts_shadow: None,
        emitter_radius: radius(&lamp, kind, scale),
    };
    out.lights.push(source.json());
    out.count("lights", 1);
    Some(out.lights.len() - 1)
}

/// The lamp's power. Files where the current field is still called `energy` have no
/// `energy_new`; those that have one carry the power there, and keep in `energy` the value
/// inherited from the old unit. The name present in the SDNA decides, never a position.
fn energy(lamp: &At<'_>) -> f32 {
    if lamp.has("energy_new") {
        return lamp.float("energy_new", 0.0);
    }
    lamp.float("energy", 0.0)
}

/// What the power is divided by to become an on-axis intensity: the whole sphere for a point and
/// a spot, the lambertian hemisphere of an area, and nothing for a sun, whose strength is
/// already an illuminance.
fn spread(kind: i64) -> f64 {
    match kind {
        LA_SUN => 1.0,
        LA_AREA => 1.0 / std::f64::consts::PI,
        _ => 1.0 / (4.0 * std::f64::consts::PI),
    }
}

/// The two half-angles of a spot's cone, in radians. `spotsize` is the **full** angle of the
/// cone, and `spotblend` the fraction that softens toward its edge.
fn cone(lamp: &At<'_>) -> (f64, f64) {
    let outer = f64::from(lamp.float("spotsize", 0.0)) / 2.0;
    crate::import::cone_angles(outer, f64::from(lamp.float("spotblend", 0.0)))
}

/// The radius of the emissive envelope, in world metres, or nothing when the lamp carries none.
fn radius(lamp: &At<'_>, kind: i64, scale: f64) -> Option<f64> {
    let local = match kind {
        LA_SUN => return None,
        LA_AREA => area_radius(lamp),
        _ if lamp.has("radius") => f64::from(lamp.float("radius", 0.0)),
        _ => f64::from(lamp.float("shadow_soft_size", 0.0)),
    };
    Some(local * scale).filter(|value| value.is_finite() && *value > 0.0)
}

/// The radius of the sphere that contains an area lamp's emissive surface: the half-diagonal of
/// a square or rectangle, the half-diameter of a disk, the semi-major axis of an ellipse.
fn area_radius(lamp: &At<'_>) -> f64 {
    let x = f64::from(lamp.float("area_size", 0.0));
    let y = f64::from(lamp.float("area_sizey", 0.0));
    match lamp.int("area_shape", LA_AREA_SQUARE) {
        LA_AREA_DISK => x / 2.0,
        LA_AREA_ELLIPSE => x.max(y) / 2.0,
        LA_AREA_SQUARE => x.hypot(x) / 2.0,
        _ => x.hypot(y) / 2.0,
    }
}
