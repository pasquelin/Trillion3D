//! The probes of a batch of bricks: the 4³ samples each brick holds, traced pass after pass. A
//! pass draws, for every probe, the paths of the two hemispheres around it, jittered inside its
//! cell by the pass; their light adds up as spherical harmonics. The sun's shadowing is a count
//! of the first 32 passes whose ray toward it reaches the sky.
use super::accumulate::{texel_of, usable, Accumulator, SHADOWING_PASSES};
use super::irradiance::{CacheSettings, Effect, IrradianceCache};
use super::kernel::{trace_path, PathContext, Scratch};
use super::layout::{layout_position, Layout};
use super::lights::BakeLight;
use super::random::{halton, probe_morton, strong_hash, Sequence};
use super::sampling::{tangent_to_world, uniform_cone, Vec3};
use super::settings::{BakeSettings, BRICK_SIZE};
use super::store::Store;
use super::world::BakeWorld;
use crate::Result;
use rayon::prelude::*;
use std::ops::Range;
use std::sync::atomic::AtomicBool;

/// Bricks a batch holds.
pub const BATCH_BRICKS: usize = 2048;
/// Probes of a brick.
const BRICK_PROBES: usize = (BRICK_SIZE * BRICK_SIZE * BRICK_SIZE) as usize;

/// What the bake reads while it traces.
pub struct Scene<'a> {
    pub layout: &'a Layout,
    pub settings: &'a BakeSettings,
    pub world: &'a BakeWorld,
    pub lights: &'a [BakeLight],
    /// A distance that crosses the scene and the volume.
    pub reach: f64,
    /// Whether the bake fills the layer of the sky's bent normal.
    pub bent: bool,
}

/// Where a probe is: its cell, in finest-brick fourths, and the seed of its sequences.
struct Site {
    cell: [i64; 3],
    seed: u32,
    brick: usize,
    inside: [u32; 3],
}

fn sites(scene: &Scene<'_>, bricks: Range<usize>) -> Vec<Site> {
    let dims = scene.layout.indirection_dims.map(|d| u64::from(d) * 4);
    let mut out = Vec::with_capacity(bricks.len() * BRICK_PROBES);
    for brick in bricks {
        let b = scene.layout.bricks[brick];
        for k in 0..BRICK_PROBES as u32 {
            let inside = [
                k % BRICK_SIZE,
                (k / BRICK_SIZE) % BRICK_SIZE,
                k / BRICK_SIZE / BRICK_SIZE,
            ];
            let cell: [i64; 3] = std::array::from_fn(|a| {
                (i64::from(b.position[a]) * 4 + i64::from(inside[a])) * i64::from(b.span)
            });
            let seed = (cell[0] as u64)
                .wrapping_add((cell[1] as u64).wrapping_mul(dims[0]))
                .wrapping_add((cell[2] as u64).wrapping_mul(dims[0] * dims[1]));
            out.push(Site {
                cell,
                seed: seed as u32,
                brick,
                inside,
            });
        }
    }
    out
}

/// The probe's place in the world at the pass `effective`: its cell, moved by the pass's jitter.
fn position(scene: &Scene<'_>, site: &Site, effective: u32) -> Vec3 {
    let morton = probe_morton(site.cell);
    let jitter = [2, 3, 5].map(|base| halton(morton.wrapping_add(effective), base));
    let b = scene.layout.bricks[site.brick];
    let layout = scene.layout;
    std::array::from_fn(|a| {
        let step = layout.volume_size[a] / f64::from(layout.indirection_dims[a]) / 4.0;
        let jittered = (f64::from(b.position[a]) * 4.0 + f64::from(site.inside[a]) + jitter[a]
            - 0.5)
            * f64::from(b.span);
        layout.volume_min[a] + step * jittered
    })
}

/// One probe's pass: the paths of its two hemispheres and, in the first passes, its ray toward the
/// sun. Returns what the paths want of the irradiance cache.
fn run_probe(
    scene: &Scene<'_>,
    context: &PathContext<'_>,
    (site, accumulator): (&Site, &mut Accumulator),
    (frame, effective): (u32, u32),
    scratch: &mut Scratch,
) -> [Option<Effect>; 2] {
    if effective == 0 {
        *accumulator = Accumulator {
            shadowing: accumulator.shadowing,
            ..Accumulator::default()
        };
    }
    let probe = position(scene, site, effective);
    let mut effects = [None, None];
    let mut counted = false;
    for (half, effect) in effects.iter_mut().enumerate() {
        let facing = [0.0, if half == 0 { 1.0 } else { -1.0 }, 0.0];
        let mut sequence = Sequence::new(site.seed, effective);
        let mut result = trace_path(context, (probe, facing), frame, &mut sequence, scratch);
        *effect = result.effect.take();
        if !usable(&result) {
            break;
        }
        accumulator.add(&result);
        counted = true;
    }
    accumulator.count += u32::from(counted);
    if frame < SHADOWING_PASSES {
        shade(scene, site, probe, frame, accumulator);
    }
    effects
}

/// The probe's ray toward the sun, if the scene has one: the pass's share of its shadowing.
fn shade(scene: &Scene<'_>, site: &Site, probe: Vec3, frame: u32, accumulator: &mut Accumulator) {
    let Some((axis, sine)) = scene.lights.iter().find_map(BakeLight::as_sun) else {
        return;
    };
    if frame == 0 {
        accumulator.shadowing = 0;
    }
    let hashed = strong_hash(site.seed).wrapping_add(frame);
    let draw = [halton(hashed, 5), halton(hashed, 7)];
    let (local, _) = uniform_cone(draw, sine * sine);
    let direction = tangent_to_world(local, axis);
    accumulator.shadow(!scene.world.blocked(probe, direction, scene.reach));
}

/// The pass `frame`'s index in the sequences: the passes that read the cache count from zero.
fn effective_pass(settings: &BakeSettings, frame: u32) -> u32 {
    let building = settings.building_passes();
    if building > 0 && frame >= building {
        frame - building
    } else {
        frame
    }
}

/// Traces every pass of the bricks `bricks`; the accumulators come back in probe order.
fn trace_batch(
    scene: &Scene<'_>,
    cache: &mut Option<IrradianceCache>,
    bricks: Range<usize>,
    (stop, passed): (&AtomicBool, &impl Fn(u32)),
) -> Result<(Vec<Site>, Vec<Accumulator>)> {
    let sites = sites(scene, bricks);
    let mut accumulators = vec![Accumulator::default(); sites.len()];
    for frame in 0..scene.settings.total_passes() {
        crate::plugins::scene::cancel::check(stop)?;
        let effective = effective_pass(scene.settings, frame);
        let context = PathContext {
            world: scene.world,
            lights: scene.lights,
            cache: cache.as_ref(),
            reach: scene.reach,
            bent: scene.bent,
        };
        let probes = accumulators.par_iter_mut().zip(sites.par_iter()).map_init(
            Scratch::default,
            |scratch, (accumulator, site)| {
                run_probe(
                    scene,
                    &context,
                    (site, accumulator),
                    (frame, effective),
                    scratch,
                )
            },
        );
        // The effects only feed the irradiance cache: with it off, none are gathered.
        if context.cache.is_some() {
            let effects: Vec<Effect> = probes
                .flat_map_iter(|pair| pair.into_iter().flatten())
                .collect();
            if let Some(store) = cache.as_mut() {
                store.apply(effects);
            }
        } else {
            probes.for_each(drop);
        }
        passed(frame);
    }
    Ok((sites, accumulators))
}

/// Bakes the bricks `bricks` into `store`: every pass traced (`passed` told after each), then each
/// probe written where its brick lies in the atlas, valid when enough of its paths held.
pub fn bake_batch(
    scene: &Scene<'_>,
    cache: &mut Option<IrradianceCache>,
    bricks: Range<usize>,
    (store, stop, passed): (&mut Store, &AtomicBool, &impl Fn(u32)),
) -> Result<()> {
    let (sites, accumulators) = trace_batch(scene, cache, bricks, (stop, passed))?;
    let trusted = (scene.settings.total_passes() - scene.settings.building_passes()) / 3;
    for (site, accumulator) in sites.iter().zip(&accumulators) {
        let place = layout_position(site.brick as u32);
        let at = store.index(std::array::from_fn(|a| {
            place[a] as usize * super::layout::PADDED as usize + site.inside[a] as usize
        }));
        if accumulator.count > 0 {
            let smoothing = scene.settings.spherical_harmonic_smoothing;
            store.write(at, &texel_of(accumulator, smoothing));
        }
        // The brick's mean distance to the geometry: a probe that met none is a reach away.
        let near = f64::from(accumulator.nearest).min(scene.reach);
        store.distance[site.brick] += (near / BRICK_PROBES as f64) as f32;
        store.valid[at] = u8::from(accumulator.count > trusted);
    }
    Ok(())
}

/// The irradiance cache the settings ask for, none without one.
pub fn new_cache(settings: &BakeSettings) -> Option<IrradianceCache> {
    settings.irradiance_caching.then(|| {
        IrradianceCache::new(CacheSettings {
            quality: settings.irradiance_cache_quality,
            spacing: settings.irradiance_cache_spacing * 100.0,
            corner_rejection: settings.irradiance_cache_corner_rejection,
        })
    })
}
