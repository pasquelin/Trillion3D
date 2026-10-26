//! The light a surface receives from the scene's lights, drawn two ways and weighed: a light
//! picked by its estimated share and sampled (`next_event`), and a light met by the ray a bounce
//! has just drawn (`met_lights`). A light of no extent is found the first way alone.
use super::kernel::{PathContext, Scratch, Stand};
use super::sampling::{positive, power_heuristic, Vec3};
use super::world::offset_origin;
use std::f64::consts::PI;
use trillion3d_math::vector::vecn::{add, dot, scale};

pub(super) fn times(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

impl PathContext<'_> {
    /// The light the draw `e` picks for a surface at `point`, with the share it was picked by; the
    /// lights' shares are kept in `scratch`. None when no light gives the point anything.
    pub(super) fn pick_light(
        &self,
        point: Vec3,
        e: f64,
        scratch: &mut Scratch,
    ) -> Option<(usize, f64)> {
        scratch.cumulative.clear();
        let mut total = 0.0;
        for light in self.lights {
            total += light.estimate(point);
            scratch.cumulative.push(total);
        }
        scratch.total = total;
        if total <= 0.0 {
            return None;
        }
        let chosen = scratch
            .cumulative
            .partition_point(|&c| c <= e * total)
            .min(self.lights.len() - 1);
        Some((chosen, scratch.pick_probability(chosen)))
    }

    /// The light picked for the surface `on` by the draw `draw`, sampled and shadowed, with the
    /// weight of its strategy, added to `radiance`; the lights' shares are kept in `scratch`.
    pub(super) fn next_event(
        &self,
        on: &Stand,
        draw: &[f64; 4],
        carried: Vec3,
        scratch: &mut Scratch,
        radiance: &mut Vec3,
    ) {
        let Some((chosen, pick)) = self.pick_light(on.point, draw[0], scratch) else {
            return;
        };
        let light = &self.lights[chosen];
        let sample = light.sample(on.point, [draw[1], draw[2]], self.reach);
        let cosine = dot(on.normal, sample.direction);
        let pdf = sample.pdf * pick;
        if cosine <= 0.0 || !positive(pdf) {
            return;
        }
        if light.casts_shadow {
            let origin = offset_origin(on.point, on.reached, on.normal);
            if self
                .world
                .blocked(origin, sample.direction, sample.distance)
            {
                return;
            }
        }
        let material_pdf = cosine / PI;
        let weight = power_heuristic(pdf, material_pdf) * material_pdf / pick;
        let given = scale(times(sample.radiance_over_pdf, on.base), weight);
        *radiance = add(*radiance, times(carried, given));
    }

    /// The lights the ray `ray` (from a surface, drawn with density `material_pdf`) meets, shadowed
    /// and weighed against their own sampling, added to `radiance`.
    pub(super) fn met_lights(
        &self,
        ray: (Vec3, Vec3),
        material_pdf: f64,
        carried: Vec3,
        scratch: &Scratch,
        radiance: &mut Vec3,
    ) {
        let weighs = scratch.total > 0.0;
        for (index, light) in self.lights.iter().enumerate() {
            let Some(met) = light.trace(ray.0, ray.1, self.reach) else {
                continue;
            };
            let mut given = times(carried, met.radiance);
            if weighs {
                let pick = scratch.pick_probability(index);
                given = scale(given, power_heuristic(material_pdf, met.pdf * pick));
            }
            if !given.iter().any(|&c| positive(c)) {
                continue;
            }
            if light.casts_shadow && self.world.blocked(ray.0, ray.1, met.distance) {
                continue;
            }
            *radiance = add(*radiance, given);
        }
    }
}
