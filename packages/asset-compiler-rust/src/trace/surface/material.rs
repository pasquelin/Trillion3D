//! What a traced hit reads of its material: base colour and coverage, packed ORM and
//! the normal map, from the factors and the texels of each texture's mip chain — the chain's
//! carried tail `texture` already reduced, its finest level `PREVIEW_BASE` texels at most,
//! where a sample sees a whole face (the voxels), or the whole chain of the decoded image, which the
//! HLOD atlas bake filters on the GPU the same way (`hlod/flatten/bake/gpu`) —, filtered over the
//! sample's footprint as the GPU filters a texture. A material cuts where the texture chains take
//! its coverage (`coverage_cut`), on the filtered alpha. Each texture's levels and their filter
//! are `texels.rs`'s.
use crate::compiler::materials::{coverage_cutoff, AlphaMode, MaterialFactors};
use crate::compiler::tables::materials::slot;
use crate::cutout::CUTOUT_ALPHA;
use crate::texture::coverage::{keeps, material_cut, Cut};
use crate::texture::{AtlasKind, TexturePreview};
use serde_json::Value;
use std::sync::Arc;
use trillion3d_math::scalar::unit_to_byte;

mod texels;
pub(crate) use texels::Texels;

/// Texture coordinate steps across a footprint, `[du, dv]` along each of its two sides.
pub(crate) type Across = [[f64; 2]; 2];

/// Where a material cuts its coverage, as the texture chains judge it (`coverage_cutoff`): a
/// cutting `MASK` at its cutoff, a `BLEND` that does not transmit at `CUTOUT_ALPHA`, the
/// threshold `cutout` gives a reclassified one; `None` when the engine draws it opaque.
pub(crate) fn coverage_cut(material: &Value) -> Option<Cut> {
    coverage_cutoff(material)
        .map(|cutoff| material_cut(material, cutoff.unwrap_or(CUTOUT_ALPHA as f32)))
}

/// The texture slots a hit reads, in the order of `Surface::sets` and `Surface::transforms`: base
/// colour, metal-roughness, occlusion, normal map, emission, specular and anisotropy — the last
/// four read only by an atlas baking them (`hlod/flatten/bake`, `merge/tile.rs`); the voxels carry
/// none of them.
pub(crate) const SLOTS: usize = 7;
/// The metal-roughness map's slot.
pub(crate) const METAL_ROUGH_SLOT: usize = 1;
/// The occlusion map's slot (its red channel).
pub(crate) const OCCLUSION_SLOT: usize = 2;
/// The normal map's slot.
pub(crate) const NORMAL_SLOT: usize = 3;
/// The emission map's slot.
pub(crate) const EMISSION_SLOT: usize = 4;
/// The specular map's slot (`KHR_materials_specular`'s `specularTexture`, its alpha).
pub(crate) const SPECULAR_SLOT: usize = 5;
/// The anisotropy map's slot (`KHR_materials_anisotropy`'s `anisotropyTexture`: the direction in
/// its red and green channels, the strength in its blue).
pub(crate) const ANISOTROPY_SLOT: usize = 6;

/// The specular input of a material declaring no `KHR_materials_specular`: one half, a
/// dielectric's reflectance of four hundredths on an input whose full scale gives eight — the
/// reflectance that extension's factor of one keeps, so a declared factor scales this half.
const SPECULAR: f64 = 0.5;

/// A material as a traced hit reads it.
#[derive(Clone)]
pub(crate) struct Surface {
    /// `baseColorFactor`, linear RGBA.
    pub factor: [f64; 4],
    pub colour: Option<Arc<Texels>>,
    /// Metal-roughness then occlusion textures, data atlas, and the occlusion's `strength`.
    pub metal_rough: Option<Arc<Texels>>,
    pub occlusion: Option<Arc<Texels>>,
    pub occlusion_strength: f64,
    /// `roughnessFactor`, `metallicFactor`.
    pub rough_metal: [f64; 2],
    /// The normal map, data atlas, and its `scale`.
    pub normal_map: Option<Arc<Texels>>,
    pub normal_scale: f64,
    /// Where the material cuts its coverage; `None` when opaque.
    pub cut: Option<Cut>,
    /// Whether it draws blended (`AlphaMode::Blend`).
    pub blend: bool,
    /// `KHR_materials_transmission`'s factor: the share of what lies behind it seen through it.
    pub transmission: f64,
    /// Its emission, linear (`emissiveFactor` times its strength), and its emission map, colour
    /// atlas.
    pub emission: [f64; 3],
    pub emission_map: Option<Arc<Texels>>,
    /// Its specular input: half its `KHR_materials_specular` factor — one half where it declares
    /// none, a dielectric's reflectance of four hundredths —, and its specular map, data atlas, its
    /// alpha read.
    pub specular: f64,
    pub specular_map: Option<Arc<Texels>>,
    /// Its `KHR_materials_anisotropy`: the strength (0 where it declares none), the direction's
    /// rotation in the tangent plane, radians, and the map, data atlas.
    pub anisotropy: f64,
    pub anisotropy_rotation: f64,
    pub anisotropy_map: Option<Arc<Texels>>,
    /// The texture coordinate set each texture reads, in `SLOTS` order.
    pub sets: [u64; SLOTS],
    /// Each texture's `KHR_texture_transform`, as the affine rows `[a, b, c, d, e, f]` of
    /// `u' = a·u + b·v + c`, `v' = d·u + e·v + f`, in `SLOTS` order.
    pub transforms: [[f64; 6]; SLOTS],
}

/// A texture slot as the material table reads it (`slot`): its texture, the set it samples and
/// its `KHR_texture_transform`, composed as the engine's texture does (`host/prepared/textures.ts`:
/// `offset`, `rotation`, `repeat`): turned, then scaled, then offset.
fn texture(material: &Value, pointer: &str) -> (Option<u64>, u64, [f64; 6]) {
    let slot = slot(material.pointer(pointer));
    let number = |p: &str, default: f64| slot.pointer(p).and_then(Value::as_f64).unwrap_or(default);
    let (ox, oy) = (
        number("/transform/offset/0", 0.0),
        number("/transform/offset/1", 0.0),
    );
    let (sx, sy) = (
        number("/transform/scale/0", 1.0),
        number("/transform/scale/1", 1.0),
    );
    let (sin, cos) = number("/transform/rotation", 0.0).sin_cos();
    let rows = [sx * cos, sx * sin, ox, -sy * sin, sy * cos, oy];
    (
        slot["texture"].as_u64(),
        slot["texCoord"].as_u64().unwrap_or(0),
        rows,
    )
}

impl Surface {
    /// Material `id` of `g`, or glTF's default material, its textures read from the carried tails
    /// of `previews`.
    pub fn of(g: &Value, id: Option<u64>, previews: &[TexturePreview]) -> Self {
        Self::with(g, id, &|texture, atlas, coverage| {
            Texels::of(previews, texture, atlas, coverage).map(Arc::new)
        })
    }

    /// Material `id` of `g`, or glTF's default material, each texture's chain in an atlas — with
    /// coverage, the coverage chain where one exists — given by `chain`.
    pub fn with(
        g: &Value,
        id: Option<u64>,
        chain: &dyn Fn(Option<u64>, AtlasKind, bool) -> Option<Arc<Texels>>,
    ) -> Self {
        let empty = Value::Null;
        let material = id
            .and_then(|id| g.pointer(&format!("/materials/{id}")))
            .unwrap_or(&empty);
        let factors = MaterialFactors::of(material);
        let pointers = [
            "/pbrMetallicRoughness/baseColorTexture",
            "/pbrMetallicRoughness/metallicRoughnessTexture",
            "/occlusionTexture",
            "/normalTexture",
            "/emissiveTexture",
            "/extensions/KHR_materials_specular/specularTexture",
            "/extensions/KHR_materials_anisotropy/anisotropyTexture",
        ];
        let read = pointers.map(|pointer| texture(material, pointer));
        let cut = coverage_cut(material);
        let number = |pointer: &str, default: f64| {
            material
                .pointer(pointer)
                .and_then(Value::as_f64)
                .unwrap_or(default)
        };
        Self {
            factor: factors.base_colour,
            colour: chain(read[0].0, AtlasKind::Color, cut.is_some()),
            metal_rough: chain(read[METAL_ROUGH_SLOT].0, AtlasKind::Data, false),
            occlusion: chain(read[OCCLUSION_SLOT].0, AtlasKind::Data, false),
            occlusion_strength: number("/occlusionTexture/strength", 1.0),
            rough_metal: [factors.roughness, factors.metallic],
            normal_map: chain(read[NORMAL_SLOT].0, AtlasKind::Data, false),
            normal_scale: number("/normalTexture/scale", 1.0),
            cut,
            blend: AlphaMode::of(material) == AlphaMode::Blend,
            transmission: factors.transmission.clamp(0.0, 1.0),
            emission: factors.emission,
            emission_map: chain(read[EMISSION_SLOT].0, AtlasKind::Color, false),
            specular: SPECULAR * factors.specular,
            specular_map: chain(read[SPECULAR_SLOT].0, AtlasKind::Data, false),
            anisotropy: number(
                "/extensions/KHR_materials_anisotropy/anisotropyStrength",
                0.0,
            ),
            anisotropy_rotation: number(
                "/extensions/KHR_materials_anisotropy/anisotropyRotation",
                0.0,
            ),
            anisotropy_map: chain(read[ANISOTROPY_SLOT].0, AtlasKind::Data, false),
            sets: read.map(|r| r.1),
            transforms: read.map(|r| r.2),
        }
    }

    /// Whether the surface covers its texel at `uv` (base colour set) — the base colour's alpha
    /// filtered over `across`, then cut —, under a vertex colour alpha `tint`, which scales the
    /// factor as the engine's surface opacity does.
    pub fn keeps(&self, uv: [f64; 2], across: Across, tint: f64) -> bool {
        self.cut.is_none_or(|(cutoff, factor)| {
            let alpha = self
                .colour
                .as_ref()
                .map_or(1.0, |t| t.sample(uv, across)[3]);
            keeps(unit_to_byte(alpha), (cutoff, factor * tint as f32))
        })
    }

    /// Linear base colour at `uv`, filtered over `across`.
    pub fn colour(&self, uv: [f64; 2], across: Across) -> [f64; 3] {
        let texel = self.colour.as_ref().map(|t| t.sample(uv, across));
        [0, 1, 2].map(|c| self.factor[c] * texel.map_or(1.0, |t| t[c]))
    }

    /// Occlusion, roughness, metallic in `[0, 1]`, at the coordinates of each texture's set,
    /// filtered over its footprint.
    pub fn orm(&self, uv: [[f64; 2]; 3], across: [Across; 3]) -> [f64; 3] {
        let unit = |t: &Option<Arc<Texels>>, k: usize, c: usize| {
            t.as_ref().map_or(1.0, |t| t.sample(uv[k], across[k])[c])
        };
        [
            unit(&self.occlusion, 2, 0),
            self.rough_metal[0] * unit(&self.metal_rough, 1, 1),
            self.rough_metal[1] * unit(&self.metal_rough, 1, 2),
        ]
    }
}
