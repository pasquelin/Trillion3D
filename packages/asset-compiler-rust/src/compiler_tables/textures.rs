//! Texture table: each texture's image and sampler state, read from the very glTF the cache
//! publishes. Filters and wrapping are the sampler constants of glTF 2.0; a texture without a
//! sampler takes the specification's defaults, the very ones the loader falls back to.
use super::*;

fn wrap(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_u64) {
        Some(33071) => "clamp",
        Some(33648) => "mirror",
        _ => "repeat",
    }
}
fn filter(value: Option<&Value>, default: &'static str) -> &'static str {
    match value.and_then(Value::as_u64) {
        Some(9728) => "nearest",
        Some(9729) => "linear",
        Some(9984) => "nearest-mip-nearest",
        Some(9985) => "linear-mip-nearest",
        Some(9986) => "nearest-mip-linear",
        Some(9987) => "linear-mip-linear",
        _ => default,
    }
}
/// The image a texture shows, the one the reference loader reads: the WebP, then the AVIF source
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
