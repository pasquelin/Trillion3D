//! The flattened materials published as every material of the scene is: each atlas image read by
//! a texture of its own, its mip chain cooked by the one texture bake
//! (`texture_preview::bake::cook_decoded`) — the levels the engine streams, the tail the manifest
//! carries —, and a glTF material naming them, so the scene tables declare it and the engine builds
//! its surface as any other's (`host/prepared/materials.ts`). An image whose every chain is whole
//! needs no source: its record names the one-pixel stand-in the engine decodes in place of a baked
//! image (`texture/skip.ts`), and no PNG is written; one whose chain lacks a level is a PNG beside
//! `source.gltf`, the source the engine reads instead.
use super::bake::Atlas;
use crate::texture_preview::collect::AtlasTexture;
use crate::texture_preview::{AtlasKind, PreviewSource, TexturePreview};
use crate::{Options, Result};
use image::ImageEncoder;
use serde_json::{json, Value};

/// What an atlas image is to the material: base colour, normal map or metal-roughness map — the
/// maps the bake writes (`bake.rs`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Role {
    Base,
    Normal,
    MetalRough,
}

impl Role {
    pub fn name(self) -> &'static str {
        match self {
            Self::Base => "base",
            Self::Normal => "normal",
            Self::MetalRough => "metal-rough",
        }
    }
    /// The atlas the engine keeps it in and the channels its shader reads
    /// (`texture_preview::collect`'s roles).
    fn reader(self) -> AtlasTexture {
        let (kind, channels, normal_only) = match self {
            Self::Base => (AtlasKind::Color, [true, true, true, false], false),
            Self::Normal => (AtlasKind::Data, [true, true, true, false], true),
            Self::MetalRough => (AtlasKind::Data, [false, true, true, false], false),
        };
        AtlasTexture {
            texture: 0,
            kind,
            channels,
            normal_only,
            cutoffs: Vec::new(),
        }
    }
}

/// One atlas image: its role, its PNG where a chain is not whole, and its cooked chains, their
/// texture and image ranks set when the scene places them (`place`).
pub(crate) struct Image {
    pub role: Role,
    pub png: Option<Vec<u8>>,
    pub previews: Vec<TexturePreview>,
}

/// The images of `atlas`, cooked, each fingerprinted by its pixels; encoded as a PNG only where a
/// chain is not whole. The atlas comes back as it was, its pixels moved through each cook rather
/// than copied, for a layer above that reads it (`sources::atlas_surface`).
pub(crate) fn images(o: &Options, atlas: Atlas) -> Result<(Vec<Image>, Atlas)> {
    let size = atlas.size as u32;
    // The three images cooked side by side: each holds its own cook (`atlas_bytes`).
    let Atlas {
        base,
        normal,
        metal_rough,
        size: side,
        tone,
    } = atlas;
    let (base, (normal, metal_rough)) = rayon::join(
        || cooked(o, size, Role::Base, base),
        || {
            rayon::join(
                || cooked(o, size, Role::Normal, normal),
                || cooked(o, size, Role::MetalRough, metal_rough),
            )
        },
    );
    let ((base, base_pixels), (normal, normal_pixels)) = (base?, normal?);
    let (metal_rough, metal_rough_pixels) = metal_rough?;
    let atlas = Atlas {
        size: side,
        base: base_pixels,
        normal: normal_pixels,
        metal_rough: metal_rough_pixels,
        tone,
    };
    Ok((vec![base, normal, metal_rough], atlas))
}

/// One `size` texels square image of the atlas, `pixels` its RGBA bytes, cooked for `role`; the
/// pixels given back.
fn cooked(o: &Options, size: u32, role: Role, pixels: Vec<u8>) -> Result<(Image, Vec<u8>)> {
    let sha256 = crate::hash(&pixels);
    let decoded = image::RgbaImage::from_raw(size, size, pixels)
        .ok_or_else(|| crate::CompilerError::new("HLOD_ATLAS", "atlas size"))?;
    let baked = crate::texture_preview::bake::cook_decoded(
        o,
        (&decoded, &sha256, PreviewSource::Uri),
        0,
        &[role.reader()],
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
    let image = Image {
        role,
        png,
        previews: baked.previews,
    };
    Ok((image, decoded.into_raw()))
}

/// One actor's flattened material as the scene publishes it: its images and its name.
pub(crate) struct Published {
    pub name: String,
    pub images: Vec<Image>,
}

/// The glTF material named `name` wearing a flattened material's textures, `[base, normal,
/// metal-rough]` by texture rank, its roughness and metallic factors glTF's default 1 so the map
/// holds each texel's own; single-sided — a closed shell is drawn on its outer faces alone.
pub(crate) fn flattened_material(
    name: &str,
    [base, normal, metal_rough]: [Option<usize>; 3],
) -> Value {
    json!({
        "name": name,
        "pbrMetallicRoughness": {
            "baseColorTexture": {"index": base},
            "metallicRoughnessTexture": {"index": metal_rough},
        },
        "normalTexture": {"index": normal},
        "doubleSided": false,
    })
}

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

/// `materials` appended to the published document `scene` — each image as an image named
/// `uri(material, image)`, at that address where it has a PNG, else at the stand-in
/// (`crate::BAKED_IMAGE`, the one-pixel PNG an image whose chains are whole names as its
/// source), a texture over it with a clamped, mipmapped sampler, each material naming its
/// textures —; the images' chains given their ranks. Returns the glTF material rank of each, in
/// order, and the chains.
pub(crate) fn place(
    scene: &mut Value,
    materials: &mut [Published],
    uri: &dyn Fn(&Published, &Image) -> String,
) -> (Vec<usize>, Vec<TexturePreview>) {
    let count = |name: &str| {
        scene
            .get(name)
            .and_then(Value::as_array)
            .map_or(0, Vec::len)
    };
    let (mut image_rank, mut texture_rank) = (count("images"), count("textures"));
    if materials.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let sampler = count("samplers");
    let mut material_rank = count("materials");
    let mut added = (Vec::new(), Vec::new(), Vec::new());
    let mut ranks = Vec::new();
    let mut previews = Vec::new();
    for material in materials.iter_mut() {
        // Each role's texture rank, by `Role as usize`.
        let mut slot = [None::<usize>; 3];
        let names: Vec<String> = material
            .images
            .iter()
            .map(|image| uri(material, image))
            .collect();
        for (image, name) in material.images.iter_mut().zip(names) {
            let address = if image.png.is_some() {
                name.as_str()
            } else {
                crate::BAKED_IMAGE
            };
            added
                .0
                .push(json!({"name": name, "uri": address, "mimeType": "image/png"}));
            added
                .1
                .push(json!({"source": image_rank, "sampler": sampler}));
            for preview in &mut image.previews {
                preview.texture = texture_rank as u32;
                preview.image = image_rank as u32;
            }
            previews.append(&mut image.previews);
            slot[image.role as usize] = Some(texture_rank);
            image_rank += 1;
            texture_rank += 1;
        }
        added.2.push(flattened_material(&material.name, slot));
        ranks.push(material_rank);
        material_rank += 1;
    }
    let mut extend = |name: &str, values: Vec<Value>| {
        if values.is_empty() {
            return;
        }
        let list = scene
            .as_object_mut()
            .expect("a glTF document")
            .entry(name)
            .or_insert_with(|| json!([]));
        if let Some(list) = list.as_array_mut() {
            list.extend(values);
        }
    };
    // Linear filtering, mipmapped, clamped at the atlas's edges (glTF's 9729, 9987, 33071).
    extend(
        "samplers",
        vec![json!({"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071})],
    );
    extend("images", added.0);
    extend("textures", added.1);
    extend("materials", added.2);
    (ranks, previews)
}
