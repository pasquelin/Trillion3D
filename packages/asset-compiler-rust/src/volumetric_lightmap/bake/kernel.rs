//! One path from a probe: the walk that gathers the light arriving at a point of the volume from
//! one hemisphere. The probe is a surface of its own, of unit colour, facing up or down; its ray
//! leaves by a uniform direction, so that its weight is the whole hemisphere's, and the path goes
//! on from surface to surface — at each one a light is drawn and shadowed, then a bounce is drawn
//! by the cosine — up to `MAX_BOUNCES`, a path surviving a bounce in proportion to the light it
//! still carries. A path that meets the back of a surface drawn on one side only is no sample.
use super::irradiance::{Decision, Effect, IrradianceCache};
use super::lights::BakeLight;
use super::nee::times;
use super::random::Sequence;
use super::sampling::{
    cosine_hemisphere_world, positive, tangent_to_world, uniform_hemisphere, Vec3,
};
use super::world::{offset_origin, BakeWorld};
use std::f64::consts::PI;
use trillion3d_math::vector::vecn::{add, scale};

/// The bounce at which a path ends whatever it still carries.
const MAX_BOUNCES: u32 = 32;
/// The size the push off the probe is chosen with: a centimetre.
const PROBE_REACH: f64 = 0.01;

/// What a path is traced in.
pub struct PathContext<'a> {
    pub world: &'a BakeWorld,
    pub lights: &'a [BakeLight],
    pub cache: Option<&'a IrradianceCache>,
    /// A distance that crosses the scene and the volume.
    pub reach: f64,
}

/// What the lights' choice at a surface leaves for the rays of the bounce after it.
#[derive(Default)]
pub struct Scratch {
    pub(super) cumulative: Vec<f64>,
    pub(super) total: f64,
}

/// What one path gathered.
pub struct PathResult {
    pub radiance: Vec3,
    /// The direction the probe's ray left by.
    pub direction: Vec3,
    pub valid: bool,
    /// What the path wants of the irradiance cache once its pass is over.
    pub effect: Option<Effect>,
}

/// The surface a path stands on.
pub(super) struct Stand {
    pub point: Vec3,
    pub normal: Vec3,
    /// How far the ray that reached it travelled, for the push off the surface.
    pub reached: f64,
    pub base: Vec3,
}

fn brightest(c: Vec3) -> f64 {
    c[0].max(c[1]).max(c[2])
}

/// The probe seen as a surface: the point, the normal of its hemisphere, unit colour.
fn probe_stand(point: Vec3, normal: Vec3) -> Stand {
    Stand {
        point,
        normal,
        reached: PROBE_REACH,
        base: [1.0; 3],
    }
}

/// How the walk goes on from a surface: the direction, the density it was drawn with and the
/// weight of the colour it carries.
struct Bounce {
    direction: Vec3,
    pdf: f64,
    weight: Vec3,
}

fn bounce_from(bounce: u32, on: &Stand, draw: &[f64; 4]) -> Bounce {
    if bounce == 0 {
        let (local, pdf) = uniform_hemisphere([draw[1], draw[0]]);
        return Bounce {
            direction: tangent_to_world(local, on.normal),
            pdf,
            weight: [1.0 / pdf; 3],
        };
    }
    let (direction, pdf) = cosine_hemisphere_world([draw[0], draw[1]], on.normal);
    Bounce {
        direction,
        pdf,
        weight: on.base,
    }
}

#[derive(PartialEq)]
enum Flow {
    On,
    Stop,
}

/// The walk of a path: where it stands, what it carries and has gathered, what it asks of the cache.
struct Walk<'a> {
    context: &'a PathContext<'a>,
    probe: Vec3,
    pass: u32,
    radiance: Vec3,
    carried: Vec3,
    valid: bool,
    ray: (Vec3, Vec3),
    on: Stand,
    direction: Vec3,
    probe_pdf: f64,
    fill: Option<u32>,
    place: Option<(u32, u32)>,
}

impl Walk<'_> {
    /// The ray reaches a surface: its emission is gathered, and the path stands on it unless it
    /// ends there (past the last bounce, or on a black surface) or falls out of the sample (the
    /// back of a surface drawn on one side only).
    fn arrive(&mut self, bounce: u32) -> Flow {
        let Some(hit) = self
            .context
            .world
            .closest(self.ray.0, self.ray.1, self.context.reach)
        else {
            return Flow::Stop;
        };
        let glow = times(self.carried, hit.emission);
        if bounce == MAX_BOUNCES || brightest(times(self.carried, hit.base)) <= 0.0 {
            self.radiance = add(self.radiance, glow);
            return Flow::Stop;
        }
        if !hit.usable {
            self.valid = false;
            return Flow::Stop;
        }
        self.on = Stand {
            point: hit.point,
            normal: hit.normal,
            reached: hit.distance,
            base: hit.base,
        };
        match (self.context.cache, self.fill) {
            (Some(store), None) => self.consult(store, bounce, glow),
            _ => {
                self.radiance = add(self.radiance, glow);
                Flow::On
            }
        }
    }

    /// What the irradiance cache knows of the surface the path stands on, whose emission is `glow`.
    /// A cell holds the radiance that leaves its surface, emission included, so a path it ends
    /// takes the cell's and not the emission besides.
    fn consult(&mut self, store: &IrradianceCache, bounce: u32, glow: Vec3) -> Flow {
        let on = &self.on;
        let decision = store.query(self.pass, bounce, self.probe, on.point, on.normal);
        if let Decision::Cached(mean) = decision {
            self.radiance = add(self.radiance, times(self.carried, mean));
            return Flow::Stop;
        }
        self.radiance = add(self.radiance, glow);
        match decision {
            Decision::Place(key) => {
                self.place = Some(key);
                Flow::Stop
            }
            Decision::Fill(record) => {
                self.fill = Some(record);
                Flow::On
            }
            _ => Flow::On,
        }
    }

    /// The bounce is drawn and the path leaves the surface, unless it ends; the lights its ray
    /// meets are gathered.
    fn leave(&mut self, bounce: u32, draw: &[f64; 4], scratch: &Scratch) -> Flow {
        let step = bounce_from(bounce, &self.on, draw);
        if !positive(step.pdf) {
            return Flow::Stop;
        }
        let next = times(self.carried, step.weight);
        if !next.iter().any(|&c| c > 0.0) {
            return Flow::Stop;
        }
        let keep = (brightest(next) / brightest(self.carried))
            .clamp(0.0, 1.0)
            .sqrt();
        if keep < 1.0 && draw[3] >= keep {
            return Flow::Stop;
        }
        self.carried = if keep < 1.0 {
            scale(next, 1.0 / keep)
        } else {
            next
        };
        let origin = offset_origin(self.on.point, self.on.reached, self.on.normal);
        self.ray = (origin, step.direction);
        if bounce == 0 {
            self.direction = step.direction;
            self.probe_pdf = step.pdf;
        } else {
            let carried = self.carried;
            self.context
                .met_lights(self.ray, step.pdf, carried, scratch, &mut self.radiance);
        }
        Flow::On
    }

    /// What the path gathered, and what it leaves the cache: the cell it placed, or the radiance
    /// it gathered for the cell it was filling.
    fn finish(self) -> PathResult {
        let effect = if !self.valid {
            None
        } else if let Some(key) = self.place {
            Some(Effect::Place(key))
        } else {
            self.fill.map(|record| Effect::Add {
                record,
                radiance: self.radiance.map(|c| (c * self.probe_pdf) as f32),
            })
        };
        PathResult {
            radiance: self.radiance,
            direction: self.direction,
            valid: self.valid,
            effect,
        }
    }
}

/// Traces one path from `probe` through the hemisphere around `facing` (up or down), at `pass`
/// of the bake, its numbers drawn from `sequence`.
pub fn trace_path(
    context: &PathContext<'_>,
    (probe, facing): (Vec3, Vec3),
    pass: u32,
    sequence: &mut Sequence,
    scratch: &mut Scratch,
) -> PathResult {
    let mut walk = Walk {
        context,
        probe,
        pass,
        radiance: [0.0; 3],
        carried: [1.0; 3],
        valid: true,
        ray: (probe, facing),
        on: probe_stand(probe, facing),
        direction: [0.0; 3],
        probe_pdf: 1.0 / (2.0 * PI),
        fill: None,
        place: None,
    };
    for bounce in 0..=MAX_BOUNCES {
        if bounce > 0 && walk.arrive(bounce) == Flow::Stop {
            break;
        }
        let draw = sequence.next4();
        if bounce > 0 && !context.lights.is_empty() {
            let (on, carried) = (&walk.on, walk.carried);
            context.next_event(on, &draw, carried, scratch, &mut walk.radiance);
        }
        if walk.leave(bounce, &draw, scratch) == Flow::Stop {
            break;
        }
    }
    walk.finish()
}
