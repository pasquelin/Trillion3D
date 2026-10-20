//! What a traced hit reads of its material: base colour and coverage, packed ORM and
//! the normal map, from the factors and the texels of each texture's mip chain — the chain's
//! carried tail `texture_preview` already reduced, its finest level `PREVIEW_BASE` texels at most,
//! where a sample sees a whole face (the voxels), or the whole chain of the decoded image, where it
//! sees one texel of the HLOD atlas (`compiler_world_roots/flatten`) —, filtered over the sample's
//! footprint as the GPU filters a texture. A material cuts where the texture chains take its
//! coverage (`coverage_cut`), on the filtered alpha.
use crate::compiler_materials::{coverage_cutoff, AlphaMode, MaterialFactors};
use crate::compiler_tables::materials::slot;
use crate::cutout::CUTOUT_ALPHA;
use crate::texture_preview::coverage::{keeps, material_cut, Cut};
use crate::texture_preview::{preview_last_level, preview_level_size, AtlasKind, TexturePreview};
use serde_json::Value;
use std::sync::Arc;
use trillion3d_math::color::srgb_byte_to_linear;
use trillion3d_math::scalar::{byte_to_unit, unit_to_byte};

/// Texture coordinate steps across a footprint, `[du, dv]` along each of its two sides.
pub(crate) type Across = [[f64; 2]; 2];

/// One texture's levels, finest first, each half the one before, RGBA8 as the chain holds them,
/// read linear — a colour atlas's colours from sRGB —: filtered trilinearly with repeat, as the GPU
/// reads a texture, bilinear in the two levels around the footprint's, blended.
pub(crate) struct Texels {
    /// Each level's width, height and RGBA8 texels.
    levels: Vec<(usize, usize, Vec<u8>)>,
    /// Each byte's linear value per channel: sRGB's curve on a colour atlas's three colours.
    decode: [[f32; 256]; 4],
}
impl Texels {
    /// The finest carried level of `texture`'s chain in `atlas`, when the stage baked one. A
    /// texture read by several materials has one chain each kind: with `coverage`, a coverage
    /// chain comes first, since its reduced levels keep level 0's coverage and a plain one's
    /// do not.
    fn of(
        previews: &[TexturePreview],
        texture: Option<u64>,
        atlas: AtlasKind,
        coverage: bool,
    ) -> Option<Self> {
        let chains = previews
            .iter()
            .filter(|p| Some(u64::from(p.texture)) == texture && p.kind.atlas() == atlas);
        let preview =
            chains.min_by_key(|p| !(coverage && matches!(p.kind, AtlasKind::Coverage(_))))?;
        let last = preview_last_level(preview.width, preview.height);
        let mut from = 0;
        let levels: Vec<(usize, usize, Vec<u8>)> = (preview.first_level..=last)
            .map_while(|level| {
                let (w, h) = preview_level_size(preview.width, preview.height, level);
                let (w, h) = (w as usize, h as usize);
                let pixels = preview.pixels.get(from..from + w * h * 4)?.to_vec();
                from += w * h * 4;
                Some((w, h, pixels))
            })
            .collect();
        (!levels.is_empty()).then(|| Self::new(levels, atlas == AtlasKind::Color))
    }

    /// Levels of RGBA8 texels, read linear, a colour atlas's colours from sRGB.
    pub fn new(levels: Vec<(usize, usize, Vec<u8>)>, srgb: bool) -> Self {
        let decode = std::array::from_fn(|c| {
            std::array::from_fn(|byte| {
                let byte = byte as u8;
                (if srgb && c < 3 {
                    srgb_byte_to_linear(byte)
                } else {
                    byte_to_unit(byte)
                }) as f32
            })
        });
        Self { levels, decode }
    }

    /// The texture at `uv` filtered over the footprint `across`, linear RGBA in `[0, 1]`: the level
    /// whose texel the footprint's longer side spans, between two levels blended.
    pub fn sample(&self, uv: [f64; 2], across: Across) -> [f64; 4] {
        let (width, height, _) = self.levels[0];
        let spans = across.map(|[du, dv]| (du * width as f64).hypot(dv * height as f64));
        let last = (self.levels.len() - 1) as f64;
        let lod = spans[0].max(spans[1]).max(1.0).log2().min(last);
        let (level, blend) = (lod.floor() as usize, lod.fract());
        let fine = self.bilinear(level, uv);
        if blend == 0.0 {
            return fine;
        }
        let coarse = self.bilinear(level + 1, uv);
        std::array::from_fn(|c| fine[c] + (coarse[c] - fine[c]) * blend)
    }

    /// Level `level` at `uv`, bilinear between its four nearest texels, with repeat.
    fn bilinear(&self, level: usize, uv: [f64; 2]) -> [f64; 4] {
        let (width, height, pixels) = &self.levels[level];
        let (w, h) = (*width as i64, *height as i64);
        let value = |x: i64, y: i64, c: usize| {
            let at = (y.rem_euclid(h) * w + x.rem_euclid(w)) as usize * 4 + c;
            f64::from(self.decode[c][pixels[at] as usize])
        };
        let (x, y) = (uv[0] * w as f64 - 0.5, uv[1] * h as f64 - 0.5);
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let (x0, y0) = (x0 as i64, y0 as i64);
        std::array::from_fn(|c| {
            let row = |y| value(x0, y, c) * (1.0 - fx) + value(x0.wrapping_add(1), y, c) * fx;
            row(y0) * (1.0 - fy) + row(y0.wrapping_add(1)) * fy
        })
    }
}

/// Where a material cuts its coverage, as the texture chains judge it (`coverage_cutoff`): a
/// cutting `MASK` at its cutoff, a `BLEND` that does not transmit at `CUTOUT_ALPHA`, the
/// threshold `cutout` gives a reclassified one; `None` when the engine draws it opaque.
pub(crate) fn coverage_cut(material: &Value) -> Option<Cut> {
    coverage_cutoff(material)
        .map(|cutoff| material_cut(material, cutoff.unwrap_or(CUTOUT_ALPHA as f32)))
}

/// The texture slots a hit reads, in the order of `Surface::sets` and `Surface::transforms`: base
/// colour, metal-roughness, occlusion, normal map — no emission: neither the voxels nor the HLOD
/// atlases carry one: the flattened material bakes a base colour, a normal map and a
/// metal-roughness map, nothing else.
pub(crate) const SLOTS: usize = 4;
/// The metal-roughness map's slot.
pub(crate) const METAL_ROUGH_SLOT: usize = 1;
/// The normal map's slot.
pub(crate) const NORMAL_SLOT: usize = 3;

/// A material as a traced hit reads it.
#[derive(Clone)]
pub(crate) struct Surface {
    /// `baseColorFactor`, linear RGBA.
    pub factor: [f64; 4],
    pub colour: Option<Arc<Texels>>,
    /// Metal-roughness then occlusion textures, data atlas.
    pub metal_rough: Option<Arc<Texels>>,
    pub occlusion: Option<Arc<Texels>>,
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
            metal_rough: chain(read[1].0, AtlasKind::Data, false),
            occlusion: chain(read[2].0, AtlasKind::Data, false),
            rough_metal: [factors.roughness, factors.metallic],
            normal_map: chain(read[NORMAL_SLOT].0, AtlasKind::Data, false),
            normal_scale: number("/normalTexture/scale", 1.0),
            cut,
            blend: AlphaMode::of(material) == AlphaMode::Blend,
            transmission: factors.transmission.clamp(0.0, 1.0),
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

    /// Roughness, metallic in `[0, 1]`: the factors, times the metal-roughness map at `uv`
    /// (its set), filtered over `across`, where the material has one.
    pub fn rough_metal(&self, uv: [f64; 2], across: Across) -> [f64; 2] {
        let texel = self.metal_rough.as_ref().map(|t| t.sample(uv, across));
        [0, 1].map(|i| self.rough_metal[i] * texel.map_or(1.0, |t| t[i + 1]))
    }

    /// The tangent-space normal the map holds at `uv` (normal set), filtered over `across`,
    /// its first two components scaled by `scale`, as glTF reads it; `None` without a map.
    pub fn tangent_normal(&self, uv: [f64; 2], across: Across) -> Option<[f64; 3]> {
        let texel = self.normal_map.as_ref()?.sample(uv, across);
        let [x, y, z] = [0, 1, 2].map(|c| texel[c] * 2.0 - 1.0);
        Some([x * self.normal_scale, y * self.normal_scale, z])
    }
}
