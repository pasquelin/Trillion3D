//! Texture table: each texture's image and sampler state, read from the very glTF the cache
//! publishes. Filters and wrapping are the sampler constants of glTF 2.0; a texture without a
//! sampler takes the specification's defaults, the very ones the loader falls back to.
use super::*;
use crate::gltf_codes::{
    CLAMP_TO_EDGE, LINEAR, LINEAR_MIPMAP_LINEAR, LINEAR_MIPMAP_NEAREST, MIRRORED_REPEAT, NEAREST,
    NEAREST_MIPMAP_LINEAR, NEAREST_MIPMAP_NEAREST,
};

fn wrap(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_u64).map(|code| code as u32) {
        Some(CLAMP_TO_EDGE) => "clamp",
        Some(MIRRORED_REPEAT) => "mirror",
        _ => "repeat",
    }
}
fn filter(value: Option<&Value>, default: &'static str) -> &'static str {
    match value.and_then(Value::as_u64).map(|code| code as u32) {
        Some(NEAREST) => "nearest",
        Some(LINEAR) => "linear",
        Some(NEAREST_MIPMAP_NEAREST) => "nearest-mip-nearest",
        Some(LINEAR_MIPMAP_NEAREST) => "linear-mip-nearest",
        Some(NEAREST_MIPMAP_LINEAR) => "nearest-mip-linear",
        Some(LINEAR_MIPMAP_LINEAR) => "linear-mip-linear",
        _ => default,
    }
}
/// The image a texture shows, the one the table publishes: the WebP, then the AVIF source
/// an extension declares (a texture may carry no other), else the core `source`.
fn texture_image(texture: &Value) -> Option<u64> {
    ["EXT_texture_webp", "EXT_texture_avif"]
        .iter()
        .find_map(|name| texture.pointer(&format!("/extensions/{name}/source")))
        .or_else(|| texture.get("source"))
        .and_then(Value::as_u64)
}
/// Sampler state of every texture of the published scene, at its own rank. A texture without a
/// sampler takes the specification's defaults, the very ones the loader falls back to.
pub(super) fn texture_table(g: &Value) -> Vec<Value> {
    let samplers = g.get("samplers").and_then(Value::as_array);
    let empty = json!({});
    g.get("textures")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|texture| {
            let sampler = texture
                .get("sampler")
                .and_then(Value::as_u64)
                .and_then(|id| samplers.and_then(|list| list.get(id as usize)))
                .unwrap_or(&empty);
            json!({
                "name": texture.get("name").and_then(Value::as_str).unwrap_or(""),
                "sampler": texture.get("sampler").and_then(Value::as_u64),
                "image": texture_image(texture),
                "wrapS": wrap(sampler.get("wrapS")),
                "wrapT": wrap(sampler.get("wrapT")),
                "magFilter": filter(sampler.get("magFilter"), "linear"),
                "minFilter": filter(sampler.get("minFilter"), "linear-mip-linear"),
            })
        })
        .collect()
}
