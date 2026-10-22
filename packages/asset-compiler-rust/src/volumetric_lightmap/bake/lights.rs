//! The lights a bake shines: the scene's punctual lights (`compiler/lights.rs`), each read once
//! into what the sampling needs. The engine draws the direct light of every light itself, so each
//! is a stationary one: the lightmap holds only what a light gives after a bounce. A point or a
//! spot is a sphere of the light's `emitterRadius` (a point of no size when it names none), the
//! sun a disk of its `angularRadius`; a light that has an extent is also found by the rays of a
//! material, and the two ways of finding it are weighed against each other.
use super::sampling::{luminance, one_minus_cos, tangent_to_world, uniform_cone, Vec3};
use serde_json::Value;
use std::f64::consts::PI;
use trillion3d_math::vector::vec3::unit;
use trillion3d_math::vector::vecn::{dot, length, scale, sub};

/// How far a spot's cone fades at its edge, in cosine, when the light declares no inner cone: the
/// engine's own edge (`spotEdgeSoftness`).
const SPOT_EDGE: f64 = 0.02;
/// The share of the squared distance a sphere light's squared radius may reach: a point is never
/// inside the light it is lit by.
const OUTSIDE: f64 = 0.99;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Directional = 0,
    Point = 1,
    Spot = 2,
}

/// A light of the scene.
#[derive(Clone, Copy)]
pub struct BakeLight {
    pub kind: Kind,
    /// Radiant power of the colour: W/m² for the sun, W/sr for the others.
    power: Vec3,
    position: Vec3,
    /// The way to the sun; the axis the light of a spot leaves along.
    axis: Vec3,
    /// The range's inverse, zero for the sun.
    inverse_range: f64,
    /// A spot's cosine at its edge and the inverse of its fade, in cosine.
    spot: (f64, f64),
    /// A sphere light's radius in metres; the sine of the sun's half-angle.
    radius: f64,
    pub casts_shadow: bool,
}

/// A direction drawn toward a light.
pub struct LightSample {
    pub direction: Vec3,
    /// How far the shadow ray goes: to the light's surface.
    pub distance: f64,
    /// The light's radiance over the density of the direction, with its attenuation.
    pub radiance_over_pdf: Vec3,
    pub pdf: f64,
}

/// A light met by a ray.
pub struct LightHit {
    pub radiance: Vec3,
    pub pdf: f64,
    pub distance: f64,
}

fn triple(value: Option<&Value>) -> Option<Vec3> {
    let items = value?.as_array()?;
    Some([0, 1, 2].map(|k| items.get(k).and_then(Value::as_f64).unwrap_or(0.0)))
}

fn number(light: &Value, key: &str) -> Option<f64> {
    light.get(key)?.as_f64().filter(|v| v.is_finite())
}

/// The light of one `lights.json` entry, none for a kind the bake does not shine.
fn read_light(entry: &Value) -> Option<BakeLight> {
    let kind = match entry.get("kind")?.as_str()? {
        "directional" => Kind::Directional,
        "point" => Kind::Point,
        "spot" => Kind::Spot,
        _ => return None,
    };
    let power = scale(triple(entry.get("color"))?, number(entry, "intensity")?);
    let direction = triple(entry.get("direction")).and_then(unit);
    let mut light = BakeLight {
        kind,
        power,
        position: triple(entry.get("position")).unwrap_or([0.0; 3]),
        axis: direction.unwrap_or([0.0, -1.0, 0.0]),
        inverse_range: number(entry, "range").map_or(0.0, |r| 1.0 / r),
        spot: (0.0, 1.0),
        radius: number(entry, "emitterRadius").unwrap_or(0.0).max(0.0),
        casts_shadow: entry.get("castsShadow").and_then(Value::as_bool) == Some(true),
    };
    match kind {
        Kind::Directional => {
            light.axis = scale(light.axis, -1.0);
            light.radius = number(entry, "angularRadius").unwrap_or(0.0).max(0.0).sin();
        }
        Kind::Spot => light.spot = spot_cone(entry),
        Kind::Point => {}
    }
    Some(light)
}

/// A spot's cosine at its edge and the inverse of the cosine's fade to its full light: the
/// declared penumbra's inner cone, never narrower than the engine's edge.
fn spot_cone(entry: &Value) -> (f64, f64) {
    let outer = number(entry, "coneAngle").unwrap_or(std::f64::consts::FRAC_PI_4);
    let edge = outer.cos();
    let penumbra = number(entry, "penumbra").unwrap_or(0.0).clamp(0.0, 1.0);
    let inner = (outer * (1.0 - penumbra)).cos().max(edge + SPOT_EDGE);
    (edge, 1.0 / (inner - edge))
}

/// The scene's lights in the order the bake draws them: the suns, then the points, then the spots.
pub fn read_lights(scene_lights: &Value) -> Vec<BakeLight> {
    let mut lights: Vec<BakeLight> = scene_lights["lights"]
        .as_array()
        .map(|entries| entries.iter().filter_map(read_light).collect())
        .unwrap_or_default();
    lights.sort_by_key(|light| light.kind as u8);
    lights
}

impl BakeLight {
    /// The range window of the squared distance `d2`.
    fn falloff(&self, d2: f64) -> f64 {
        let normalised = d2 * self.inverse_range * self.inverse_range;
        (1.0 - normalised * normalised).clamp(0.0, 1.0).powi(2)
    }

    /// A spot's fade for the unit direction `to_light` from the lit point.
    fn cone(&self, to_light: Vec3) -> f64 {
        if self.kind != Kind::Spot {
            return 1.0;
        }
        let (edge, inverse) = self.spot;
        ((-dot(to_light, self.axis) - edge) * inverse)
            .clamp(0.0, 1.0)
            .powi(2)
    }

    /// The light's attenuation toward a point `away` from it (the vector from the point to the
    /// light's centre), the squared distance in `d2`.
    fn attenuation(&self, away: Vec3, d2: f64) -> f64 {
        self.falloff(d2) * self.cone(scale(away, 1.0 / d2.sqrt()))
    }

    /// Whether a ray of a material can meet the light: the sun's disk or a sphere.
    pub fn has_extent(&self) -> bool {
        self.radius > 0.0
    }

    /// An upper bound of what the light gives the point `p`, which weighs the choice of a light.
    pub fn estimate(&self, p: Vec3) -> f64 {
        let power = luminance(self.power);
        if self.kind == Kind::Directional {
            return power;
        }
        let away = sub(self.position, p);
        let d2 = dot(away, away);
        power * self.attenuation(away, d2) / d2
    }

    /// A direction toward the light from `p`, drawn with `e`; `reach` is how far a ray to the sun
    /// goes.
    pub fn sample(&self, p: Vec3, e: [f64; 2], reach: f64) -> LightSample {
        if self.kind == Kind::Directional {
            let (local, pdf) = uniform_cone(e, self.radius * self.radius);
            return LightSample {
                direction: tangent_to_world(local, self.axis),
                distance: reach,
                radiance_over_pdf: self.power,
                pdf,
            };
        }
        let away = sub(self.position, p);
        let d2 = dot(away, away);
        let radius2 = (OUTSIDE * d2).min(self.radius * self.radius);
        let sin2_max = radius2 / d2;
        let (local, pdf) = uniform_cone(e, sin2_max);
        let sin2 = 1.0 - local[2] * local[2];
        let reach_to_surface = length(away) * (local[2] - (sin2_max - sin2).max(0.0).sqrt());
        let radiance_over_pdf = if sin2_max < 0.001 {
            scale(self.power, 1.0 / d2)
        } else {
            scale(self.power, 1.0 / (PI * radius2 * pdf))
        };
        LightSample {
            direction: tangent_to_world(local, scale(away, 1.0 / d2.sqrt())),
            distance: reach_to_surface,
            radiance_over_pdf: scale(radiance_over_pdf, self.attenuation(away, d2)),
            pdf,
        }
    }

    /// The light as a ray from `origin` along the unit `direction` finds it, if it has an extent.
    pub fn trace(&self, origin: Vec3, direction: Vec3, reach: f64) -> Option<LightHit> {
        if !self.has_extent() {
            return None;
        }
        if self.kind == Kind::Directional {
            return self.trace_sun(direction, reach);
        }
        let to_centre = sub(origin, self.position);
        let d2 = dot(to_centre, to_centre);
        let radius2 = (OUTSIDE * d2).min(self.radius * self.radius);
        let b = dot(to_centre, direction);
        let off = sub(to_centre, scale(direction, b));
        let h = radius2 - dot(off, off);
        if h <= 0.0 {
            return None;
        }
        let t = -b - h.sqrt();
        if t <= 0.0 {
            return None;
        }
        let sin2_max = radius2 / d2;
        let solid_angle = 2.0 * PI * one_minus_cos(sin2_max);
        let away = scale(to_centre, -1.0);
        let weight = self.attenuation(away, d2) / (PI * radius2);
        Some(LightHit {
            radiance: scale(self.power, weight),
            pdf: 1.0 / solid_angle,
            distance: t,
        })
    }

    fn trace_sun(&self, direction: Vec3, reach: f64) -> Option<LightHit> {
        let opening = one_minus_cos(self.radius * self.radius);
        if 1.0 - dot(direction, self.axis).clamp(0.0, 1.0) >= opening {
            return None;
        }
        let solid_angle = 2.0 * PI * opening;
        Some(LightHit {
            radiance: scale(self.power, 1.0 / solid_angle),
            pdf: 1.0 / solid_angle,
            distance: reach,
        })
    }

    /// The unit direction toward the light and the sine of its half-angle, if it is a sun.
    pub fn as_sun(&self) -> Option<(Vec3, f64)> {
        (self.kind == Kind::Directional).then_some((self.axis, self.radius))
    }
}
