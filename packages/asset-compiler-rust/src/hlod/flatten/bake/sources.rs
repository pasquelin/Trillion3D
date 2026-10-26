//! What the bakes read of their sources: every material the HLOD merges, each texture's whole mip
//! chain decoded once from its image — the chain the GPU reads (`texture/reduce.rs`), so a
//! texel of the atlas filters the source over its footprint as the engine would draw it there —,
//! how its sampler wraps each texture and whether it draws both faces, and triangle soups in world
//! space traced with those materials (`trace::surface::Traceable`, `pieces`).
use super::gpu::Pages;
use crate::plugins::image::DecodedImage;
use crate::texture::binding::{sampler_wrap, texture_image};
use crate::texture::{linear_to_srgb, preview_level_size, AtlasKind};
use crate::trace::surface::material::{Surface, Texels};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::{Arc, Mutex};
use trillion3d_math::scalar::unit_to_byte_f32;
mod pieces;
pub(crate) use pieces::{traceable, Piece, Sources};

/// The source materials, by glTF material, with every texture's chain, in texture order, and how
/// the engine draws each beside what its surface holds (`Drawn`); the chains on the device once a
/// bake asks for them, destroyed with it (`gpu::chains`); and the compile's cancel token, which a
/// bake reads between its GPU submissions.
pub(crate) struct Library {
    surfaces: BTreeMap<Option<u64>, Surface>,
    drawn: BTreeMap<Option<u64>, Drawn>,
    pub(super) chains: Vec<Arc<Texels>>,
    pub(super) resident: Mutex<Option<Arc<Pages>>>,
    pub cancelled: Arc<std::sync::atomic::AtomicBool>,
}

/// How the engine draws a material beside what its surface holds: how the samplers of the
/// textures the bake reads wrap them (`wraps_word`), and whether it draws both faces (glTF's
/// `doubleSided`).
#[derive(Clone, Copy)]
struct Drawn {
    wraps: u32,
    double_sided: bool,
}

/// The texture slots of a material the bakes read, in the order a bake's surface lists its maps
/// (`gpu/surfaces.rs`): base colour, metal-roughness map, normal map, emission map and specular
/// map — the `GPU_SLOTS` the approximation's bake reads —, then the occlusion map and the
/// anisotropy map, which only a merged atlas baking them reads (`Maps::reads_extra_textures`,
/// `gpu/tile.wgsl`): the maps the flattened material carries (`../bake.rs`).
const SLOTS: [(&str, AtlasKind); 7] = [
    (
        "/pbrMetallicRoughness/baseColorTexture/index",
        AtlasKind::Color,
    ),
    (
        "/pbrMetallicRoughness/metallicRoughnessTexture/index",
        AtlasKind::Data,
    ),
    ("/normalTexture/index", AtlasKind::Data),
    ("/emissiveTexture/index", AtlasKind::Color),
    (
        "/extensions/KHR_materials_specular/specularTexture/index",
        AtlasKind::Data,
    ),
    ("/occlusionTexture/index", AtlasKind::Data),
    (
        "/extensions/KHR_materials_anisotropy/anisotropyTexture/index",
        AtlasKind::Data,
    ),
];

/// How many of the first `SLOTS` every bake reads.
const GPU_SLOTS: usize = 5;

/// How a sampler wraps a texture coordinate past the texture's edge along one axis, as the bake
/// reads it (`gpu/shade.wgsl`'s `wrap`): repeat, glTF's default (10497), clamp to the edge (33071),
/// mirrored repeat (33648).
pub(crate) const REPEAT: u32 = 0;
pub(crate) const CLAMP: u32 = 1;
pub(crate) const MIRROR: u32 = 2;

/// The wrap glTF's `mode` names (`REPEAT` for none, or one glTF does not define).
fn wrap_code(mode: Option<u64>) -> u32 {
    match mode {
        Some(33071) => CLAMP,
        Some(33648) => MIRROR,
        _ => REPEAT,
    }
}

/// The wraps of a surface's maps as its word holds them: per slot of `SLOTS`, four bits from the
/// slot's rank times four, its wrap along `u` in the first two, along `v` in the next two.
fn wraps_word(modes: [[u32; 2]; SLOTS.len()]) -> u32 {
    (modes.into_iter().enumerate())
        .fold(0, |word, (slot, [u, v])| word | (u | v << 2) << (4 * slot))
}

impl Library {
    /// The materials `materials` of `g`, each texture's image read from `bin` or under
    /// `image_root` and decoded once by the one image decoder (`plugins::image::decode`), whatever
    /// format it holds (`bytes_of`), as many at once as its allowance less `reserved` admits; a
    /// texture whose image does not decode reads as none, as the engine draws it white. The
    /// occlusion and anisotropy textures are decoded only where a layer of the job bakes them.
    pub fn new(
        source: (&Value, &[u8], &Path),
        materials: &BTreeSet<Option<u64>>,
        (o, reserved): (&crate::Options, usize),
    ) -> crate::Result<Self> {
        let g = source.0;
        let extra = (o.hlod.as_ref().ok()).is_some_and(|hlod| {
            (hlod.layers.iter()).any(|l| l.merge_materials && l.merging.maps.reads_extra_textures())
        });
        let read = if extra { SLOTS.len() } else { GPU_SLOTS };
        let mut wanted: BTreeSet<(u64, AtlasKind)> = BTreeSet::new();
        for id in materials.iter().flatten() {
            let Some(material) = g.pointer(&format!("/materials/{id}")) else {
                continue;
            };
            for (pointer, kind) in &SLOTS[..read] {
                if let Some(texture) = material.pointer(pointer).and_then(Value::as_u64) {
                    wanted.insert((texture, *kind));
                }
            }
        }
        // Each kind's textures decoded as many at once as the job admits (`texture/
        // admission.rs`, `decode_admitted`): the decodes in flight fit the allowance less `reserved`.
        // Each kind once, however many slots read it.
        let kinds: BTreeSet<AtlasKind> = SLOTS.iter().map(|&(_, kind)| kind).collect();
        let mut chains: BTreeMap<(u64, AtlasKind), Arc<Texels>> = BTreeMap::new();
        for kind in kinds {
            let pairs: Vec<(u64, usize)> = (wanted.iter())
                .filter(|(_, k)| *k == kind)
                .filter_map(|&(texture, _)| {
                    let entry = g.pointer(&format!("/textures/{texture}"))?;
                    Some((texture, texture_image(entry)? as usize))
                })
                .collect();
            let images: Vec<usize> = pairs.iter().map(|&(_, image)| image).collect();
            let decoded = crate::texture::admission::decode_admitted(
                o,
                reserved,
                source,
                &images,
                |image| chain_of(source, image, kind),
            )?;
            for ((texture, _), texels) in pairs.iter().zip(decoded) {
                if let Some(texels) = texels {
                    chains.insert((*texture, kind), Arc::new(texels));
                }
            }
        }
        let surfaces = materials
            .iter()
            .map(|&id| {
                let chain = |texture: Option<u64>, atlas: AtlasKind| {
                    chains.get(&(texture?, atlas)).cloned()
                };
                (id, Surface::with(g, id, &chain))
            })
            .collect();
        let drawn = (materials.iter())
            .map(|&id| {
                let material = id.and_then(|id| g.pointer(&format!("/materials/{id}")));
                (id, drawn_of(g, material))
            })
            .collect();
        Ok(Self {
            surfaces,
            drawn,
            chains: chains.into_values().collect(),
            resident: Mutex::new(None),
            cancelled: o.cancelled.clone(),
        })
    }

    /// The surface of material `id`.
    pub fn surface(&self, id: Option<u64>) -> Surface {
        self.surfaces
            .get(&id)
            .cloned()
            .expect("every merged material is in the library")
    }

    /// How material `id` is drawn beside its surface (`Drawn`).
    fn drawn(&self, id: Option<u64>) -> Drawn {
        *(self.drawn.get(&id)).expect("every merged material is in the library")
    }

    /// Whether material `id` draws both faces.
    pub fn double_sided(&self, id: Option<u64>) -> bool {
        self.drawn(id).double_sided
    }
}

/// How `material` of `g` is drawn beside its surface — glTF's default material where it is `None`,
/// which repeats and draws one face —: each slot's texture wrapped as its sampler's `wrapS` and
/// `wrapT` name, and its `doubleSided`.
fn drawn_of(g: &Value, material: Option<&Value>) -> Drawn {
    let wrap = |pointer: &str, axis: &str| {
        let index = material
            .and_then(|m| m.pointer(pointer))
            .and_then(Value::as_u64);
        let texture = index.and_then(|t| g.pointer(&format!("/textures/{t}")));
        wrap_code(texture.and_then(|texture| sampler_wrap(g, texture, axis)))
    };
    let modes = SLOTS.map(|(pointer, _)| [wrap(pointer, "wrapS"), wrap(pointer, "wrapT")]);
    Drawn {
        wraps: wraps_word(modes),
        double_sided: material
            .and_then(|m| m["doubleSided"].as_bool())
            .unwrap_or(false),
    }
}

/// The whole chain of image `image` of `source` read as `kind`, decoded once by the one image
/// decoder (`plugins::image::decode`), whatever format it holds (`bytes_of`); `None` when it does
/// not decode, as the engine draws such a texture white.
fn chain_of(
    (g, bin, image_root): (&Value, &[u8], &Path),
    image: usize,
    kind: AtlasKind,
) -> Option<Texels> {
    let image = g.pointer(&format!("/images/{image}"))?;
    let decoded =
        crate::texture::source::with_image_bytes(g, bin, image_root, image, |bytes, _| {
            crate::plugins::image::decode(bytes, crate::texture::PREVIEW_MAX_ALLOC)
        })
        .ok()?;
    Some(texels_of(bytes_of(decoded.image, kind)?, kind))
}

/// The whole chain of `rgba` read as `kind` (`texture/reduce.rs`).
fn texels_of(rgba: image::RgbaImage, kind: AtlasKind) -> Texels {
    let (w, h) = rgba.dimensions();
    // The levels the chain reduces; level 0, the image's own texels, moved in rather than copied
    // (`reduce::chain` borrows it).
    let reduced: Vec<Option<Vec<u8>>> = crate::texture::reduce::chain(&rgba, &[], kind)
        .into_iter()
        .map(|bytes| match bytes {
            std::borrow::Cow::Owned(owned) => Some(owned),
            std::borrow::Cow::Borrowed(_) => None,
        })
        .collect();
    let mut raw = Some(rgba.into_raw());
    let levels = (reduced.into_iter().enumerate())
        .map(|(level, bytes)| {
            let (lw, lh) = preview_level_size(w, h, level as u32);
            let bytes = bytes.unwrap_or_else(|| raw.take().unwrap_or_default());
            (lw as usize, lh as usize, bytes)
        })
        .collect();
    Texels::new(levels, kind == AtlasKind::Color)
}

/// The decoder's image as the RGBA8 texels a chain is reduced from: bytes as they are; linear
/// floats — what high-dynamic-range formats decode to (`plugins::image::DecodedImage::RgbaF32`) —
/// written as a byte image of `kind` stores them, a colour atlas's colours in sRGB, every other
/// value on the unit interval, so the sampler reads back the same linear value
/// (`Texels::new`).
fn bytes_of(image: DecodedImage, kind: AtlasKind) -> Option<image::RgbaImage> {
    match image {
        DecodedImage::Rgba8(rgba) => Some(rgba),
        DecodedImage::RgbaF32 {
            width,
            height,
            data,
        } => {
            let byte = |(k, &value): (usize, &f32)| {
                if kind == AtlasKind::Color && k % 4 < 3 {
                    linear_to_srgb(value)
                } else {
                    unit_to_byte_f32(value)
                }
            };
            let bytes = data.iter().enumerate().map(byte).collect();
            image::RgbaImage::from_raw(width, height, bytes)
        }
    }
}
