//! The sky's bent normal at a probe: the vector sum of the unshadowed directions toward the sky
//! over the probe's upper hemisphere, each over `π` — the mean direction the sky is seen from,
//! whose length is the sky's visibility. It is gathered at the probe's first bounce, the two ways
//! the light of a probe is, weighed against each other: the sky picked among the lights and
//! drawn (`bent_sampled`), and the sky met by the ray the probe draws (`bent_met`). A probe's
//! rays leave it by a uniform direction, so `1 / 2π` is the density of a direction for both its
//! own ray and its evaluation, whatever side of the hemisphere the direction lies.
use super::kernel::{PathContext, Scratch, Stand};
use super::lights::{BakeLight, Kind};
use super::nee::times;
use super::sampling::{positive, power_heuristic, Vec3};
use super::world::offset_origin;
use std::f64::consts::PI;
use trillion3d_math::vector::vecn::{add, scale};

/// The density a probe draws a direction with.
const PROBE_PDF: f64 = 1.0 / (2.0 * PI);
const NONE: Vec3 = [0.0; 3];

/// Whether `light` fills the sky's bent normal: a sky the scene shadows.
fn records(light: &BakeLight) -> bool {
    light.kind == Kind::Sky && light.casts_shadow
}

/// Whether any of `lights` fills the layer of the sky's bent normal.
pub fn fills_bent_normal(lights: &[BakeLight]) -> bool {
    lights.iter().any(records)
}

impl PathContext<'_> {
    /// What the light the draw `draw` picks for the probe `on` gives its bent normal when it is the
    /// sky: the direction drawn toward it over its density and `π`, weighed against the probe's
    /// own ray, none where the scene shadows it. Another light gives none.
    pub(super) fn bent_sampled(&self, on: &Stand, draw: &[f64; 4], scratch: &mut Scratch) -> Vec3 {
        let Some((chosen, pick)) = self.pick_light(on.point, draw[0], scratch) else {
            return NONE;
        };
        let light = &self.lights[chosen];
        if !records(light) {
            return NONE;
        }
        let sample = light.sample(on.point, [draw[1], draw[2]], self.reach);
        let pdf = sample.pdf * pick;
        if !positive(pdf) || !sample.radiance_over_pdf.iter().any(|&c| positive(c)) {
            return NONE;
        }
        let origin = offset_origin(on.point, on.reached, on.normal);
        if self
            .world
            .blocked(origin, sample.direction, sample.distance)
        {
            return NONE;
        }
        scale(
            sample.direction,
            power_heuristic(pdf, PROBE_PDF) / (pdf * PI),
        )
    }

    /// What the sky the ray `ray` (from the probe, the walk's `carried` weight after the draw)
    /// meets gives its bent normal: the ray's direction times what the walk carries over `π`,
    /// weighed against drawing that direction toward the sky, none where the scene shadows it.
    pub(super) fn bent_met(&self, ray: (Vec3, Vec3), carried: Vec3, scratch: &Scratch) -> Vec3 {
        let mut bent = NONE;
        for (index, light) in self.lights.iter().enumerate().filter(|(_, l)| records(l)) {
            let Some(met) = light.trace(ray.0, ray.1, self.reach) else {
                continue;
            };
            let mut weight = 1.0;
            if scratch.total > 0.0 {
                let pick = scratch.pick_probability(index);
                weight = power_heuristic(PROBE_PDF, met.pdf * pick);
            }
            let given = scale(times(carried, met.radiance), weight);
            if !given.iter().any(|&c| positive(c)) || self.world.blocked(ray.0, ray.1, met.distance)
            {
                continue;
            }
            bent = add(bent, scale(times(carried, ray.1), weight / PI));
        }
        bent
    }
}

#[cfg(test)]
mod tests {
    use super::super::kernel::trace_path;
    use super::super::lights::read_lights;
    use super::super::random::Sequence;
    use super::super::settings::SkySettings;
    use super::super::world::{BakeWorld, Instance, Materials, SceneInputs};
    use super::*;
    use std::collections::BTreeSet;
    use trillion3d_math::vector::vecn::length;

    /// A world of the triangles `triangles` (corners of three floats), every one of the default
    /// material.
    fn world_of(triangles: &[f32]) -> BakeWorld {
        let g = serde_json::json!({});
        let shown = BTreeSet::new();
        let inputs = SceneInputs {
            g: &g,
            bin: &[],
            world: &[],
            shown: &shown,
            previews: &[],
        };
        let materials = Materials::of(&inputs);
        let slots = vec![0; triangles.len() / 9];
        let instance = Instance {
            triangles: triangles.to_vec(),
            slots,
        };
        BakeWorld::build(vec![instance], &materials).expect("a world")
    }

    /// A triangle far from everything the probes see: an open sky.
    const FAR: [f32; 9] = [9e3, 9e3, 9e3, 9e3 + 1.0, 9e3, 9e3, 9e3, 9e3 + 1.0, 9e3];
    /// A roof of two triangles over the probes, 2 metres above them, 2 kilometres wide.
    const ROOF: [f32; 18] = [
        -1e3, 3.0, -1e3, 1e3, 3.0, -1e3, 1e3, 3.0, 1e3, -1e3, 3.0, -1e3, 1e3, 3.0, 1e3, -1e3, 3.0,
        1e3,
    ];

    /// The mean bent normal of the probe at (0, 1, 0), facing `facing`, over a thousand passes.
    fn mean_bent(world: &BakeWorld, sky: &SkySettings, facing: Vec3) -> Vec3 {
        let lights = read_lights(&serde_json::json!({}), Some(sky));
        let context = PathContext {
            world,
            lights: &lights,
            cache: None,
            reach: 5e3,
            bent: fills_bent_normal(&lights),
        };
        let mut mean = NONE;
        let mut scratch = Scratch::default();
        let passes = 2048;
        for pass in 0..passes {
            let mut sequence = Sequence::new(7, pass);
            let probe = [0.0, 1.0, 0.0];
            let found = trace_path(&context, (probe, facing), pass, &mut sequence, &mut scratch);
            mean = add(mean, scale(found.bent, 1.0 / f64::from(passes)));
        }
        mean
    }

    #[test]
    fn an_open_sky_over_a_black_lower_hemisphere_gives_a_bent_normal_of_length_one_along_up() {
        let world = world_of(&FAR);
        let bent = mean_bent(&world, &SkySettings::default(), [0.0, 1.0, 0.0]);
        assert!(bent[0].abs() < 0.05 && bent[2].abs() < 0.05, "{bent:?}");
        assert!((bent[1] - 1.0).abs() < 0.05, "{bent:?}");
    }

    #[test]
    fn a_roof_shuts_the_sky_and_the_lower_half_of_the_probe_keeps_none() {
        let sky = SkySettings::default();
        let roofed = mean_bent(&world_of(&ROOF), &sky, [0.0, 1.0, 0.0]);
        assert!(length(roofed) < 0.05, "{roofed:?}");
        let down = mean_bent(&world_of(&FAR), &sky, [0.0, -1.0, 0.0]);
        assert_eq!(down, NONE);
    }

    #[test]
    fn a_sky_that_casts_no_shadow_fills_no_bent_normal() {
        let sky = SkySettings {
            casts_shadows: false,
            ..SkySettings::default()
        };
        assert!(!fills_bent_normal(&read_lights(
            &serde_json::json!({}),
            Some(&sky)
        )));
        assert_eq!(mean_bent(&world_of(&FAR), &sky, [0.0, 1.0, 0.0]), NONE);
    }
}
