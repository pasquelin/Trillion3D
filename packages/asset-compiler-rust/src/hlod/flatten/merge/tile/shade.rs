//! One covered texel's bytes: what a source's triangle shows at the texel's centre (`look`), its
//! base colour, normal and metal-roughness as the flattened material carries them (`shaded`), a
//! translucent texel laid over what lies behind it (`Behind::seen`).
use super::super::smear::BACKGROUND;
use super::extra::Texel;
use super::frame::{cotangent, tangent_space};
use super::{Behind, Covered, Steps};
use crate::hlod::flatten::bake::seen::{self, Layer};
use crate::hlod::flatten::bake::sources::{Sources, CLAMP, MIRROR};
use crate::hlod::flatten::bake::{Coverage, Maps, METALLIC, ROUGHNESS};
use crate::trace::surface::material::{Wrap, METAL_ROUGH_SLOT, NORMAL_SLOT};
use crate::trace::surface::mesh::mix;
use crate::trace::tracer::{normal_of, vertex};
use trillion3d_math::scalar::unit_to_byte;
use trillion3d_math::vector::vec3::normalized_or;
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// The wrap a word of `sources::wraps_word` names for slot `slot` of the bake's maps (base
/// colour, metal-roughness, normal map, emission, specular, occlusion, anisotropy), along `u` then
/// `v`.
pub(super) fn wraps(word: u32, slot: u32) -> [Wrap; 2] {
    let bits = word >> (4 * slot);
    [bits & 3, (bits >> 2) & 3].map(|code| match code {
        CLAMP => Wrap::Clamp,
        MIRROR => Wrap::Mirror,
        _ => Wrap::Repeat,
    })
}

/// What `sources`' triangle `t` shows at `at`, its footprint's barycentric steps `steps`: its linear
/// base colour — factor, texture and vertex colour —; its roughness and metallic — factors times
/// map — where `maps` bakes them or its surface transmits, else its factors; and the share of what
/// lies behind it its own layer covers (`seen::covers`).
pub(super) fn look(
    sources: &Sources,
    (t, at, steps): (usize, [f64; 2], Steps),
    maps: Maps,
) -> Layer {
    let traced = &sources.mesh;
    let surface = traced.surface(t);
    let word = sources.wraps[traced.world.tags[t] as usize];
    let read = |k: usize| traced.uv(t, at, k, steps);
    let tint = traced.vertex_colour(t, at);
    let (uv, across) = read(0);
    let texel = (surface.colour.as_ref()).map(|c| c.sample_wrapped(uv, across, wraps(word, 0)));
    let base: [f64; 4] =
        std::array::from_fn(|c| surface.factor[c] * tint[c] * texel.map_or(1.0, |x| x[c]));
    let rough_metal = match maps.metal_rough() || surface.transmission > 0.0 {
        false => surface.rough_metal,
        true => {
            let (uv, across) = read(METAL_ROUGH_SLOT);
            let word = wraps(word, 1);
            let map = (surface.metal_rough.as_ref()).map(|m| m.sample_wrapped(uv, across, word));
            [0, 1].map(|k| surface.rough_metal[k] * map.map_or(1.0, |m| m[k + 1]))
        }
    };
    Layer {
        colour: [base[0], base[1], base[2]],
        rough_metal,
        covers: seen::covers(surface, base[3], rough_metal),
    }
}

/// The bytes of texel `(t, at)` of `sources`' triangle `t` laid at `coordinates`, its weights'
/// steps `steps`, as `maps` bakes it: base colour (sRGB) — its alpha the opacity or the mask the
/// layer bakes, one where the texel is composed over what lies behind it —, normal map,
/// metal-roughness map — the specular in its first channel where `maps` bakes it, a roughness or
/// metallic not baked its constant (`bake::ROUGHNESS`, `bake::METALLIC`) —; where the texel shows
/// what lies `behind` it, its base colour, roughness and metallic laid over that
/// (`Behind::seen`), inward along its vertex normal.
pub(super) fn shaded(
    sources: &Sources,
    (coordinates, steps): (&[[f64; 2]; 3], Steps),
    (t, at): Covered,
    (maps, behind): (Maps, Option<&Behind>),
) -> [[u8; 4]; 3] {
    let t = t as usize;
    let traced = &sources.mesh;
    let surface = traced.surface(t);
    let own = look(sources, (t, at, steps), maps);
    // The vertex normal, and the triangle's corners and edges.
    let corners = [0, 1, 2].map(|k| vertex(&traced.world, t, k));
    let edges = (sub(corners[1], corners[0]), sub(corners[2], corners[0]));
    let facing = normal_of(&traced.world, t);
    let n = match traced.corners[t].normals {
        Some(normals) => normalized_or(mix::<3>(&normals[..], at), facing),
        None => facing,
    };
    let (colour, rough_metal, composed) = match behind {
        Some(behind) if own.covers < 1.0 => {
            let along = |[a, b]: [f64; 2]| add(scale(edges.0, a), scale(edges.1, b));
            let point = add(corners[0], along(at));
            let (colour, rough_metal) =
                behind.seen(own, (point, scale(n, -1.0)), steps.map(along), maps);
            (colour, rough_metal, true)
        }
        _ => (own.colour, own.rough_metal, false),
    };
    let read = Texel {
        sources,
        t,
        at,
        steps,
    };
    let srgb = colour.map(|c| crate::texture::linear_to_srgb(c as f32));
    let alpha = match maps.coverage() {
        Coverage::Opaque => 255,
        _ if composed => 255,
        kind => unit_to_byte(read.coverage(kind)),
    };
    let base = [srgb[0], srgb[1], srgb[2], alpha];
    let metal_rough = match maps.metal_rough() {
        false => BACKGROUND,
        true => {
            let specular = if maps.specular {
                unit_to_byte(read.specular())
            } else {
                0
            };
            let rough = if maps.roughness {
                rough_metal[0]
            } else {
                ROUGHNESS
            };
            let metal = if maps.metallic {
                rough_metal[1]
            } else {
                METALLIC
            };
            [specular, unit_to_byte(rough), unit_to_byte(metal), 255]
        }
    };
    if !maps.normal {
        return [base, BACKGROUND, metal_rough];
    }
    // The vertex normal, bent by the normal map over the triangle's frame of its map's set.
    let mut normal = n;
    if let Some(map) = &surface.normal_map {
        let word = sources.wraps[traced.world.tags[t] as usize];
        let (uv, across) = traced.uv(t, at, NORMAL_SLOT, steps);
        let texel = map.sample_wrapped(uv, across, wraps(word, 2));
        let m = [0, 1, 2].map(|c| texel[c] * 2.0 - 1.0);
        let m = [
            m[0] * surface.normal_scale,
            m[1] * surface.normal_scale,
            m[2],
        ];
        let set = (surface.sets[NORMAL_SLOT] as usize).min(1);
        let uv = traced.corners[t].uv[set].map(f64::from);
        let deltas = (
            [uv[2] - uv[0], uv[3] - uv[1]],
            [uv[4] - uv[0], uv[5] - uv[1]],
        );
        let [tangent, bitangent] = cotangent(n, edges, deltas);
        let bent = add(
            sub(scale(tangent, m[0]), scale(bitangent, m[1])),
            scale(n, m[2]),
        );
        normal = normalized_or(bent, n);
    }
    if dot(normal, n) < 0.0 {
        normal = scale(normal, -1.0);
    }
    // Written in the frame the engine rebuilds from the entry's texture coordinates.
    let [a, b, c] = *coordinates;
    let frame = cotangent(n, edges, (sub(b, a), sub(c, a)));
    let m = tangent_space(normalized_or(normal, n), n, frame).map(|x| x * 0.5 + 0.5);
    let normal = [
        unit_to_byte(m[0]),
        unit_to_byte(m[1]),
        unit_to_byte(m[2]),
        255,
    ];
    [base, normal, metal_rough]
}
