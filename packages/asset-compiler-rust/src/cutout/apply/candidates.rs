//! The blend materials whose base colour a texture carries: the bindings an answer or a measurement
//! may turn cutout.
use super::*;
use crate::compiler_materials::AlphaMode;
use crate::texture_preview::collect;

/// Candidate binding: material declared in blend whose base color carries a texture.
pub(super) struct Candidate {
    pub(super) material: usize,
    pub(super) texture: usize,
    pub(super) image: usize,
    pub(super) image_sha: String,
}

/// Candidate bindings of scene, each with image fingerprint, read from the table taken once
/// (`source::ImageShas`). Unreadable image is not a candidate, preview step will name it in report
/// as it already does.
pub(super) fn candidates(
    g: &Value,
    used: &BTreeSet<usize>,
    shas: &source::ImageShas,
) -> Vec<Candidate> {
    let (Some(materials), Some(textures)) = (
        g.get("materials").and_then(Value::as_array),
        g.get("textures").and_then(Value::as_array),
    ) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for &id in used {
        let Some(material) = materials.get(id) else {
            continue;
        };
        if AlphaMode::of(material) != AlphaMode::Blend {
            continue;
        }
        let Some(texture) =
            collect::texture_index(material.pointer("/pbrMetallicRoughness/baseColorTexture"))
        else {
            continue;
        };
        let Some(image) = textures
            .get(texture)
            .and_then(|texture| texture.get("source"))
            .and_then(Value::as_u64)
            .map(|image| image as usize)
        else {
            continue;
        };
        let Some(sha) = shas.get(image) else {
            continue;
        };
        found.push(Candidate {
            material: id,
            texture,
            image,
            image_sha: sha.to_owned(),
        });
    }
    found
}
