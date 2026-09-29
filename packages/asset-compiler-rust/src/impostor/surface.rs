//! What a traced hit reads of its material: base colour and coverage, packed ORM, from the
//! factors and the texels `texture_preview` already reduced (the finest level of each chain's
//! tail, `PREVIEW_BASE` texels at most: an impostor frame sees a whole mesh, never one texel of
//! its leaves). A material cuts where `cutout` made it `MASK`, at its own cutoff; one still
//! declared `BLEND` cuts at `CUTOUT_ALPHA`, the threshold `cutout` gives a reclassified one.
use crate::albedo::srgb_to_linear;
use crate::cutout::CUTOUT_ALPHA;
use crate::texture_preview::coverage::{keeps, material_cut, Cut};
use crate::texture_preview::{preview_level_size, AtlasKind, TexturePreview};
use serde_json::Value;

/// One texture level, RGBA8, sampled nearest with repeat.
pub(crate) struct Texels {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}
impl Texels {
    /// The finest carried level of `texture`'s chain in `atlas`, when the stage baked one.
    fn of(previews: &[TexturePreview], texture: Option<u64>, atlas: AtlasKind) -> Option<Self> {
        let preview = previews
            .iter()
            .find(|p| Some(u64::from(p.texture)) == texture && p.kind.atlas() == atlas)?;
        let (w, h) = preview_level_size(preview.width, preview.height, preview.first_level);
        let (width, height) = (w as usize, h as usize);
        let pixels = preview.pixels.get(..width * height * 4)?.to_vec();
        Some(Self {
            width,
            height,
            pixels,
        })
    }
    pub fn sample(&self, uv: [f64; 2]) -> [u8; 4] {
        let texel =
            |x: f64, size: usize| ((x.rem_euclid(1.0) * size as f64) as usize).min(size - 1);
        let at = (texel(uv[1], self.height) * self.width + texel(uv[0], self.width)) * 4;
        [0, 1, 2, 3].map(|c| self.pixels[at + c])
    }
}

/// A material as the bake reads it.
pub(crate) struct Surface {
    /// `baseColorFactor`, linear RGBA.
    pub factor: [f64; 4],
    pub colour: Option<Texels>,
    /// Metal-roughness then occlusion textures, data atlas.
    pub metal_rough: Option<Texels>,
    pub occlusion: Option<Texels>,
    /// `roughnessFactor`, `metallicFactor`.
    pub rough_metal: [f64; 2],
    /// Where the material cuts its coverage; `None` when opaque.
    pub cut: Option<Cut>,
    /// The texture coordinate set each texture reads: base colour, metal-roughness, occlusion.
    pub sets: [u64; 3],
}

fn texture(material: &Value, pointer: &str) -> (Option<u64>, u64) {
    let slot = material.pointer(pointer);
    let index = slot.and_then(|s| s.get("index")).and_then(Value::as_u64);
    let set = slot.and_then(|s| s.get("texCoord")).and_then(Value::as_u64);
    (index, set.unwrap_or(0))
}

impl Surface {
    /// Material `id` of `g`, or glTF's default material.
    pub fn of(g: &Value, id: Option<u64>, previews: &[TexturePreview]) -> Self {
        let empty = Value::Null;
        let material = id
            .and_then(|id| g.pointer(&format!("/materials/{id}")))
            .unwrap_or(&empty);
        let number = |pointer: &str, default: f64| {
            material
                .pointer(pointer)
                .and_then(Value::as_f64)
                .unwrap_or(default)
        };
        let factor = [0, 1, 2, 3]
            .map(|c| number(&format!("/pbrMetallicRoughness/baseColorFactor/{c}"), 1.0));
        let (colour, colour_set) = texture(material, "/pbrMetallicRoughness/baseColorTexture");
        let (metal, metal_set) =
            texture(material, "/pbrMetallicRoughness/metallicRoughnessTexture");
        let (occlusion, occlusion_set) = texture(material, "/occlusionTexture");
        let cut = match material.get("alphaMode").and_then(Value::as_str) {
            Some("MASK") => Some(material_cut(material, number("/alphaCutoff", 0.5) as f32)),
            Some("BLEND") => Some(material_cut(material, CUTOUT_ALPHA as f32)),
            _ => None,
        };
        Self {
            factor,
            colour: Texels::of(previews, colour, AtlasKind::Color),
            metal_rough: Texels::of(previews, metal, AtlasKind::Data),
            occlusion: Texels::of(previews, occlusion, AtlasKind::Data),
            rough_metal: [
                number("/pbrMetallicRoughness/roughnessFactor", 1.0),
                number("/pbrMetallicRoughness/metallicFactor", 1.0),
            ],
            cut,
            sets: [colour_set, metal_set, occlusion_set],
        }
    }

    fn base_alpha(&self, uv: [f64; 2]) -> u8 {
        self.colour.as_ref().map_or(255, |t| t.sample(uv)[3])
    }

    /// Whether the surface covers its texel at `uv` (base colour set).
    pub fn keeps(&self, uv: [f64; 2]) -> bool {
        self.cut.is_none_or(|cut| keeps(self.base_alpha(uv), cut))
    }

    /// Linear base colour at `uv`.
    pub fn colour(&self, uv: [f64; 2]) -> [f64; 3] {
        let texel = self.colour.as_ref().map(|t| t.sample(uv));
        [0, 1, 2].map(|c| self.factor[c] * texel.map_or(1.0, |t| srgb_to_linear(t[c])))
    }

    /// Occlusion, roughness, metallic in `[0, 1]`, at the coordinates of each texture's set.
    pub fn orm(&self, uv: [[f64; 2]; 3]) -> [f64; 3] {
        let byte = |t: &Option<Texels>, uv, c: usize| {
            t.as_ref()
                .map_or(1.0, |t| f64::from(t.sample(uv)[c]) / 255.0)
        };
        [
            byte(&self.occlusion, uv[2], 0),
            self.rough_metal[0] * byte(&self.metal_rough, uv[1], 1),
            self.rough_metal[1] * byte(&self.metal_rough, uv[1], 2),
        ]
    }
}
