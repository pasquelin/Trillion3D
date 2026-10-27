//! The flattened materials published as every material of the scene is: each atlas image read by
//! a texture of its own, its mip chain cooked by the one texture bake
//! (`texture::bake::cook_decoded`) — the levels the engine streams, the tail the manifest
//! carries —, its BC7 upper pass the lighter one (`Ladder::Light`), and a glTF material naming
//! them, so the scene tables declare it and the engine builds its surface as any other's
//! (`host/prepared/materials.ts`). An image whose every chain is whole needs no source: its record
//! names the one-pixel stand-in the engine decodes in place of a baked image (`texture/skip.ts`),
//! and no PNG is written; one whose chain lacks a level is a PNG beside `source.gltf`, the source
//! the engine reads instead.
use super::{Atlas, Coverage, MASK_CUTOFF, METALLIC, ROUGHNESS};
use crate::texture::collect::AtlasTexture;
use crate::texture::{AtlasKind, Ladder, PreviewSource, TexturePreview};
use crate::{Options, Result};
use image::ImageEncoder;
use serde_json::{json, Value};
mod coverage;
mod document;
pub(crate) use coverage::{coverage_of, wear_coverage};
pub(crate) use document::place;

/// What an atlas image is to the material: base colour, normal map, metal-roughness map, emission
/// map, occlusion map or anisotropy map — the maps the bake writes (`../bake.rs`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Role {
    Base,
    Normal,
    MetalRough,
    Emission,
    Occlusion,
    Anisotropy,
}

/// How the engine reads an atlas image beyond its role: whether a metal-roughness map's first
/// channel holds the specular, and what a base image's alpha is (`Coverage`).
#[derive(Clone, Copy)]
struct Reading {
    specular: bool,
    coverage: Coverage,
}

impl Role {
    pub fn name(self) -> &'static str {
        match self {
            Self::Base => "base",
            Self::Normal => "normal",
            Self::MetalRough => "metal-rough",
            Self::Emission => "emission",
            Self::Occlusion => "occlusion",
            Self::Anisotropy => "anisotropy",
        }
    }
    /// The atlas the engine keeps it in and the channels its shader reads
    /// (`texture::collect`'s roles), a metal-roughness map's first channel too where it holds the
    /// specular, a base colour's alpha too — cut at the mask's cutoff where it holds a mask —
    /// where it holds the opacity or the mask (`Reading`).
    fn reader(self, reading: Reading) -> AtlasTexture {
        let Reading { specular, coverage } = reading;
        let all = [true; 4];
        let (kind, channels, normal_only) = match (self, coverage) {
            (Self::Base, Coverage::Blend | Coverage::Mask) => (AtlasKind::Color, all, false),
            (Self::Base | Self::Emission, _) => {
                (AtlasKind::Color, [true, true, true, false], false)
            }
            (Self::Normal, _) => (AtlasKind::Data, [true, true, true, false], true),
            (Self::MetalRough, _) => (AtlasKind::Data, [specular, true, true, false], false),
            (Self::Occlusion, _) => (AtlasKind::Data, [true, false, false, false], false),
            (Self::Anisotropy, _) => (AtlasKind::Data, [true, true, true, false], false),
        };
        let masked = self == Self::Base && coverage == Coverage::Mask;
        AtlasTexture {
            texture: 0,
            kind,
            channels,
            normal_only,
            cutoffs: if masked {
                vec![(MASK_CUTOFF as f32, 1.0)]
            } else {
                Vec::new()
            },
        }
    }
}

/// One atlas image: its role, its PNG where a chain is not whole, its cooked chains, their texture
/// and image ranks set when the scene places them (`place`), the strength the material scales it
/// by, an emission map's (`bake::Emission`), and what its alpha is, a base image's
/// (`bake::Coverage`).
pub(crate) struct Image {
    pub role: Role,
    pub png: Option<Vec<u8>>,
    pub previews: Vec<TexturePreview>,
    pub strength: Option<f32>,
    pub coverage: Coverage,
}

/// The images of `atlas` it bakes, each at its own side (`Atlas::sides`), cooked, each
/// fingerprinted by its pixels; encoded as a PNG only where a chain is not whole. The atlas's
/// pixels are moved into each cook, never copied, and let go with it: no layer reads an actor's
/// atlas.
pub(crate) fn images(o: &Options, atlas: Atlas) -> Result<Vec<Image>> {
    // The images cooked side by side: each holds its own cook (`atlas_bytes`).
    let Atlas {
        sides,
        base,
        normal,
        metal_rough,
        specular,
        emission,
        occlusion,
        anisotropy,
        coverage,
        ..
    } = atlas;
    let reading = Reading { specular, coverage };
    let cook =
        |role: Role, side: usize, pixels: Vec<u8>| cooked(o, (side as u32, role, reading), pixels);
    let optional = |role: Role, side: usize, pixels: Option<Vec<u8>>| {
        pixels.map(|pixels| cook(role, side, pixels)).transpose()
    };
    let strength = emission.as_ref().map(|e| e.strength);
    let (((base, emission), (normal, metal_rough)), (occlusion, anisotropy)) = rayon::join(
        || {
            rayon::join(
                || {
                    rayon::join(
                        || cook(Role::Base, sides.base, base),
                        || optional(Role::Emission, sides.emission, emission.map(|e| e.image)),
                    )
                },
                || {
                    rayon::join(
                        || optional(Role::Normal, sides.normal, normal),
                        || optional(Role::MetalRough, sides.metal_rough, metal_rough),
                    )
                },
            )
        },
        || {
            rayon::join(
                || optional(Role::Occlusion, sides.occlusion, occlusion),
                || optional(Role::Anisotropy, sides.anisotropy, anisotropy),
            )
        },
    );
    let emission = emission?.map(|image| Image { strength, ..image });
    let images = [
        Some(base?),
        normal?,
        metal_rough?,
        emission,
        occlusion?,
        anisotropy?,
    ];
    Ok(images.into_iter().flatten().collect())
}

/// One `size` texels square image of the atlas, `pixels` its RGBA bytes, cooked for `role`, read
/// as `reading` says (`Reading`).
fn cooked(
    o: &Options,
    (size, role, reading): (u32, Role, Reading),
    pixels: Vec<u8>,
) -> Result<Image> {
    let sha256 = crate::hash(&pixels);
    let decoded = image::RgbaImage::from_raw(size, size, pixels)
        .ok_or_else(|| crate::CompilerError::new("HLOD_ATLAS", "atlas size"))?;
    let baked = crate::texture::bake::cook_decoded(
        o,
        (&decoded, &[], None, &sha256, PreviewSource::Uri),
        (0, Ladder::Light),
        &[role.reader(reading)],
    )
    .map_err(|reason| crate::CompilerError::new("HLOD_ATLAS", reason))?;
    let whole = (baked.previews.iter()).all(|p| p.baked_levels == p.first_level);
    let png = if whole {
        None
    } else {
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(
                decoded.as_raw(),
                size,
                size,
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|e| crate::CompilerError::new("HLOD_ATLAS", format!("atlas PNG: {e}")))?;
        Some(png)
    };
    Ok(Image {
        role,
        png,
        previews: baked.previews,
        strength: None,
        coverage: if role == Role::Base {
            reading.coverage
        } else {
            Coverage::Opaque
        },
    })
}

/// One actor's flattened material as the scene publishes it: its images, its name and whether it
/// draws both faces (`Atlas::double_sided`).
pub(crate) struct Published {
    pub name: String,
    pub images: Vec<Image>,
    pub double_sided: bool,
}

/// The glTF material named `name` wearing a flattened material's textures, `[base, normal,
/// metal-rough, emission, occlusion, anisotropy]` by texture rank, the other maps where it has
/// them: with a metal-roughness map, its roughness and metallic factors glTF's default one, so the
/// map holds each texel's own — or the constant of a channel it does not bake (`maps::Maps`) —;
/// without one, the constants themselves (`ROUGHNESS`, `METALLIC`); with an emission map, the
/// map's `strength` as its emission factor where it is one at most, else a factor of one and the
/// strength as `KHR_materials_emissive_strength`'s, so the map times them is the emission baked;
/// with an occlusion map, glTF's occlusion texture; with an anisotropy map,
/// `KHR_materials_anisotropy`'s texture, its strength factor one — the map holds the strength, zero
/// where the layer bakes none —, which the engine does not draw yet. The base image's alpha, as
/// `coverage` says, the material's opacity — drawn blended — or its mask — cut at `MASK_CUTOFF`.
/// Drawing both faces when `double_sided` (`Atlas::double_sided`). A baked specular rides in the
/// metal-roughness map's first channel, which no glTF slot names: no material input reads it.
fn flattened_material(
    name: &str,
    (slots, strength): ([Option<usize>; 6], Option<f32>),
    (double_sided, coverage): (bool, Coverage),
) -> Value {
    let [base, normal, metal_rough, emission, occlusion, anisotropy] = slots;
    let mut pbr = json!({"baseColorTexture": {"index": base}});
    match metal_rough {
        Some(index) => pbr["metallicRoughnessTexture"] = json!({"index": index}),
        None => {
            pbr["roughnessFactor"] = json!(ROUGHNESS);
            pbr["metallicFactor"] = json!(METALLIC);
        }
    }
    let mut material = json!({
        "name": name,
        "pbrMetallicRoughness": pbr,
        "doubleSided": double_sided,
    });
    wear_coverage(&mut material, coverage);
    if let Some(index) = normal {
        material["normalTexture"] = json!({"index": index});
    }
    if let Some(index) = emission {
        let strength = f64::from(strength.unwrap_or(0.0));
        material["emissiveTexture"] = json!({"index": index});
        material["emissiveFactor"] =
            json!([strength.min(1.0), strength.min(1.0), strength.min(1.0)]);
        if strength > 1.0 {
            material["extensions"][EMISSIVE_STRENGTH] = json!({"emissiveStrength": strength});
        }
    }
    if let Some(index) = occlusion {
        material["occlusionTexture"] = json!({"index": index});
    }
    if let Some(index) = anisotropy {
        material["extensions"][ANISOTROPY] =
            json!({"anisotropyStrength": 1.0, "anisotropyTexture": {"index": index}});
    }
    material
}

/// The glTF extension an emission brighter than one is declared through, and the one an
/// anisotropy map is.
const EMISSIVE_STRENGTH: &str = "KHR_materials_emissive_strength";
const ANISOTROPY: &str = "KHR_materials_anisotropy";

/// glTF's default material (glTF 2.0 §3.9.2: a primitive naming no material wears it) appended to
/// the published document `scene`, written out — every factor its default — so a merged section
/// of sources naming none names it (`world::Wears`). Returns its glTF rank.
pub(crate) fn default_material(scene: &mut Value) -> usize {
    let list = (scene.as_object_mut().expect("a glTF document"))
        .entry("materials")
        .or_insert_with(|| json!([]));
    let materials = list.as_array_mut().expect("a glTF materials array");
    materials.push(json!({"name": "HLOD default material"}));
    materials.len() - 1
}
