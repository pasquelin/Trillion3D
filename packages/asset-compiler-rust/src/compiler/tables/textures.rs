//! Texture table: each texture's image and sampler state, read from the very glTF the cache
//! publishes. Wrapping is the sampler constants of glTF 2.0, filtering the importers' reading of
//! them (`filters`); a texture without a sampler takes the specification's defaults, the very ones
//! the loader falls back to.
use super::*;
use crate::compiler::accessor::codes::{
    CLAMP_TO_EDGE, LINEAR_MIPMAP_NEAREST, MIRRORED_REPEAT, NEAREST,
};
use crate::texture::binding::{sampler_of, texture_image};

fn wrap(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_u64).map(|code| code as u32) {
        Some(CLAMP_TO_EDGE) => "clamp",
        Some(MIRRORED_REPEAT) => "mirror",
        _ => "repeat",
    }
}
/// The filters a sampler's `minFilter` asks for, as `(magFilter, minFilter)` of the table; the sampler's
/// `magFilter` is not read. Nearest samples both ways the nearest texel, and the two linear
/// minifications over mipmaps keep their mip rule; any other value, or none, takes the engine's
/// default filtering — trilinear, anisotropic —, the glTF specification's `LINEAR` among them.
fn filters(sampler: &Value) -> (&'static str, &'static str) {
    match sampler
        .get("minFilter")
        .and_then(Value::as_u64)
        .map(|code| code as u32)
    {
        Some(NEAREST) => ("nearest", "nearest"),
        Some(LINEAR_MIPMAP_NEAREST) => ("linear", "linear-mip-nearest"),
        _ => ("linear", "linear-mip-linear"),
    }
}
/// Sampler state of every texture of the published scene, at its own rank. A texture without a
/// sampler takes the specification's defaults, the very ones the loader falls back to.
pub(super) fn texture_table(g: &Value) -> Vec<Value> {
    let empty = json!({});
    g.get("textures")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|texture| {
            let sampler = sampler_of(g, texture).unwrap_or(&empty);
            let (mag, min) = filters(sampler);
            json!({
                "name": name_of(texture),
                "sampler": texture.get("sampler").and_then(Value::as_u64),
                "image": texture_image(texture),
                "wrapS": wrap(sampler.get("wrapS")),
                "wrapT": wrap(sampler.get("wrapT")),
                "magFilter": mag,
                "minFilter": min,
            })
        })
        .collect()
}
