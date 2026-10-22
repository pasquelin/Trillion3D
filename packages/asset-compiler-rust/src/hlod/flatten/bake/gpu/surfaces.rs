//! The sources' surfaces as the compute passes read them (`shade.wgsl`'s `surface_of`): one record
//! per surface (`layout::SURFACE_RECORDS`), its maps naming the chains they read by rank in the
//! bake's list, each chain once however many surfaces read it, how its samplers wrap them and
//! whether it draws both faces.
use super::super::sources::Sources;
use super::layout::{READ_SLOT_COUNT, SURFACE_RECORDS};
use crate::hlod::flatten::gpu::layout::NONE;
use crate::hlod::flatten::gpu::pack::float;
use crate::trace::surface::material::{
    Surface, Texels, ANISOTROPY_SLOT, EMISSION_SLOT, METAL_ROUGH_SLOT, NORMAL_SLOT, OCCLUSION_SLOT,
    SPECULAR_SLOT,
};
use std::collections::btree_map::{BTreeMap, Entry};
use std::sync::Arc;

/// The texture slots the passes read, in the order of a surface's maps and transform rows: base
/// colour, metal-roughness, normal map, emission, specular, occlusion, anisotropy
/// (`material::SLOTS` ranks).
const READ_SLOTS: [usize; READ_SLOT_COUNT] = [
    0,
    METAL_ROUGH_SLOT,
    NORMAL_SLOT,
    EMISSION_SLOT,
    SPECULAR_SLOT,
    OCCLUSION_SLOT,
    ANISOTROPY_SLOT,
];

/// One surface's records (`layout::SURFACE_RECORDS`), its maps named by `chain` and wrapped as
/// `wraps` holds them (`sources::wraps_word`, in `READ_SLOTS` order), drawing both faces when
/// `double_sided`: its factor; its roughness, metallic, normal scale and transmission; its cut;
/// its first three slots' sets and the wraps; its first three maps and whether it draws both
/// faces; two transform rows per slot read; its emission and specular input; its emission and
/// specular maps and their sets; its occlusion and anisotropy maps — those `read` names; the
/// others none — and their sets; its occlusion's strength, its anisotropy's strength and
/// rotation.
fn pack_surface(
    out: &mut Vec<u32>,
    (surface, wraps, double_sided): (&Surface, u32, bool),
    read: (bool, bool),
    chain: &mut dyn FnMut(&Arc<Texels>) -> u32,
) {
    out.extend(surface.factor.map(float));
    let [rough, metal] = surface.rough_metal;
    out.extend([rough, metal, surface.normal_scale, surface.transmission].map(float));
    let (cutoff, factor, cuts) = match surface.cut {
        Some((cutoff, factor)) => (f64::from(cutoff), f64::from(factor), 1.0),
        None => (0.0, 0.0, 0.0),
    };
    let blend = if surface.blend { 1.0 } else { 0.0 };
    out.extend([cutoff, factor, cuts, blend].map(float));
    let sets = READ_SLOTS.map(|slot| surface.sets[slot].min(1) as u32);
    out.extend([sets[0], sets[1], sets[2], wraps]);
    for map in [&surface.colour, &surface.metal_rough, &surface.normal_map] {
        out.push(map.as_ref().map_or(NONE, &mut *chain));
    }
    out.push(u32::from(double_sided));
    for slot in READ_SLOTS {
        let [a, b, c, d, e, f] = surface.transforms[slot];
        out.extend([a, b, c, 0.0].map(float));
        out.extend([d, e, f, 0.0].map(float));
    }
    let [red, green, blue] = surface.emission;
    out.extend([red, green, blue, surface.specular].map(float));
    for map in [&surface.emission_map, &surface.specular_map] {
        out.push(map.as_ref().map_or(NONE, &mut *chain));
    }
    out.extend([sets[3], sets[4]]);
    let beyond = [
        (&surface.occlusion, read.0),
        (&surface.anisotropy_map, read.1),
    ];
    for (map, wanted) in beyond {
        out.push(match map {
            Some(map) if wanted => chain(map),
            _ => NONE,
        });
    }
    out.extend([sets[5], sets[6]]);
    let strengths = [
        surface.occlusion_strength,
        surface.anisotropy,
        surface.anisotropy_rotation,
        0.0,
    ];
    out.extend(strengths.map(float));
}

/// The records of `sources`' surfaces, in their ranks, and the chains their maps name, each once,
/// in the order the maps first name them. A shell reads no occlusion nor anisotropy map: `read`
/// names which of the two a merged atlas bakes.
pub(super) fn pack_surfaces(sources: &Sources, read: (bool, bool)) -> (Vec<u32>, Vec<Arc<Texels>>) {
    let mut rank: BTreeMap<usize, u32> = BTreeMap::new();
    let mut chains = Vec::new();
    let mut chain = |texels: &Arc<Texels>| match rank.entry(Arc::as_ptr(texels) as usize) {
        Entry::Occupied(at) => *at.get(),
        Entry::Vacant(at) => {
            chains.push(texels.clone());
            *at.insert(chains.len() as u32 - 1)
        }
    };
    let surfaces = &sources.mesh.surfaces;
    let mut out = Vec::with_capacity(surfaces.len() * SURFACE_RECORDS * 4);
    let named = (surfaces.iter())
        .zip(&sources.wraps)
        .zip(&sources.double_sided);
    for ((surface, &wraps), &both) in named {
        pack_surface(&mut out, (surface, wraps, both), read, &mut chain);
    }
    (out, chains)
}
