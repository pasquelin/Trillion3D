//! `UsdLux` lights of a layer, toward `KHR_lights_punctual`.
//!
//! **What is read.** `SphereLight` and `DiskLight` (point), `RectLight` (point too: glTF has no
//! area source) and `DistantLight` (directional), plus the `ShapingAPI` that makes a light a
//! spotlight, and the `ShadowAPI` that says whether it carries a shadow. Any other `UsdLux`
//! type — `DomeLight`, `CylinderLight`, `GeometryLight`, `PortalLight`, and filters — stays
//! counted by `world::LIGHT`, for lack of a punctual equivalent.
//!
//! **Units.** `UsdLux` is radiometric and relative: a light emits the radiance
//! `inputs:intensity · 2^inputs:exposure`, which `inputs:normalize` divides by the source area.
//! The radiant intensity of a surface light is therefore that radiance multiplied by the
//! projected area of its geometry — `π r²` for a sphere or a disk, `width × height` for a
//! rectangle —, and the illuminance of a `DistantLight` is directly that radiance. glTF, for
//! its part, is photometric: the conversion is the multiplication by `LUMENS_PER_WATT`, the
//! constant that `compiler_lights` then divides again to return to the engine's radiometric.
//! Nothing is invented between the two, no spectrum is assumed.
//!
//! **Emitter radius** comes from the native datum: `inputs:radius` for a sphere or a disk, the
//! half-diagonal of `inputs:width` × `inputs:height` for a rectangle. It is written in world
//! metres, the prim's scale and `metersPerUnit` included. `inputs:angle` of a `DistantLight` is
//! an angular diameter, not a length: a directional has neither centre nor range, and the
//! engine contract already refuses it any envelope.
use super::*;

/// Default half-angle of the `ShapingAPI` cone, in degrees.
const DEFAULT_CONE: f64 = 90.0;
/// Default radius of a `SphereLight` and a `DiskLight`, in layer units.
const DEFAULT_RADIUS: f64 = 0.5;
/// Default sides of a `RectLight`, in layer units.
const DEFAULT_SIDE: f64 = 1.0;

/// Emissive shape of a light type: what must be read to draw an area and a radius from it.
enum Shape {
    /// A sphere or a disk, by `inputs:radius`.
    Round,
    /// A rectangle, by `inputs:width` and `inputs:height`.
    Rect,
    /// A source at infinity: neither area nor radius.
    Distant,
}

/// Shape of a prim type, or `None` when this driver does not convert it.
fn shape(type_name: &str) -> Option<Shape> {
    Some(match type_name {
        "SphereLight" | "DiskLight" => Shape::Round,
        "RectLight" => Shape::Rect,
        "DistantLight" => Shape::Distant,
        _ => return None,
    })
}

/// glTF light of this prim, poured into the tables, and its rank. `scale` is the world scale
/// accumulated up to this prim, `metersPerUnit` included: it is what puts the radius into metres.
pub(super) fn build(
    world: &mut World<'_>,
    prim: &usd::Prim,
    type_name: &str,
    scale: f64,
) -> Option<usize> {
    let Some(shape) = shape(type_name) else {
        world.refuse(world::LIGHT);
        return None;
    };
    let radiance = number(world, prim, "inputs:intensity", 1.0)
        * number(world, prim, "inputs:exposure", 0.0).exp2();
    let (area, radius) = extent(world, prim, &shape, scale);
    let normalized = flag(world, prim, "inputs:normalize").unwrap_or(false);
    let cone = cone(world, prim);
    let source = crate::import::LightSource {
        name: prim.path().name().unwrap_or("Light").to_string(),
        kind: match (&shape, cone.is_some()) {
            (Shape::Distant, _) => "directional",
            (_, true) => "spot",
            (_, false) => "point",
        },
        colour: colour(world, prim),
        intensity: crate::compiler_lights::photometric(
            radiance * if normalized { 1.0 } else { area },
        ),
        cone,
        casts_shadow: flag(world, prim, "inputs:shadow:enable"),
        emitter_radius: radius.filter(|value| value.is_finite() && *value > 0.0),
    };
    world.scene.lights.push(source.json());
    world.count("lights", 1);
    Some(world.scene.lights.len() - 1)
}

/// Projected area of the source, in square metres, and the radius of its envelope, in metres. A
/// source at infinity has neither: its area is one, intensity remaining illuminance.
fn extent(
    world: &mut World<'_>,
    prim: &usd::Prim,
    shape: &Shape,
    scale: f64,
) -> (f64, Option<f64>) {
    match shape {
        Shape::Round => {
            let radius = number(world, prim, "inputs:radius", DEFAULT_RADIUS) * scale;
            (std::f64::consts::PI * radius * radius, Some(radius))
        }
        Shape::Rect => {
            let width = number(world, prim, "inputs:width", DEFAULT_SIDE) * scale;
            let height = number(world, prim, "inputs:height", DEFAULT_SIDE) * scale;
            (width * height, Some(width.hypot(height) / 2.0))
        }
        Shape::Distant => (1.0, None),
    }
}

/// Two half-angles of a spotlight cone, in radians, or `None` when the prim does not carry the
/// `ShapingAPI`. `inputs:shaping:cone:softness` is the fraction of the cone that softens: the
/// inner half-angle is what that fraction leaves.
fn cone(world: &mut World<'_>, prim: &usd::Prim) -> Option<(f64, f64)> {
    let outer = read(world, prim, "inputs:shaping:cone:angle")?.to_radians();
    let softness = number(world, prim, "inputs:shaping:cone:softness", 0.0);
    let outer = if outer.is_finite() {
        outer
    } else {
        DEFAULT_CONE.to_radians()
    };
    Some(crate::import::cone_angles(outer, softness))
}

/// Light colour, finite and non-negative channels; white by default, like `UsdLux`.
fn colour(world: &mut World<'_>, prim: &usd::Prim) -> [f64; 3] {
    let Some((value, sampled)) = read::first(&prim.attribute("inputs:color")) else {
        return [1.0; 3];
    };
    if sampled {
        world.refuse(world::TIME_SAMPLE);
    }
    read::triple(&value).map_or([1.0; 3], |rgb| {
        rgb.map(|c| if c.is_finite() && c >= 0.0 { c } else { 1.0 })
    })
}

/// A numeric attribute of the light, or its `UsdLux` default when it does not write it.
fn number(world: &mut World<'_>, prim: &usd::Prim, name: &str, default: f64) -> f64 {
    read(world, prim, name)
        .filter(|value| value.is_finite())
        .unwrap_or(default)
}

/// A numeric attribute written by the light, and nothing when it does not write it: that is
/// how a light shaped as a spotlight is distinguished from a light that is not.
fn read(world: &mut World<'_>, prim: &usd::Prim, name: &str) -> Option<f64> {
    let (value, sampled) = read::first(&prim.attribute(name))?;
    if sampled {
        world.refuse(world::TIME_SAMPLE);
    }
    read::number(&value)
}

/// A boolean attribute written by the light, and nothing when it does not write it.
fn flag(world: &mut World<'_>, prim: &usd::Prim, name: &str) -> Option<bool> {
    let (value, sampled) = read::first(&prim.attribute(name))?;
    if sampled {
        world.refuse(world::TIME_SAMPLE);
    }
    read::flag(&value)
}
