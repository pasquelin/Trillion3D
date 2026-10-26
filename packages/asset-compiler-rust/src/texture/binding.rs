//! What a glTF texture names: the image it shows and the sampler it is read through. The one
//! resolver of the texture table (`compiler/tables/textures.rs`), the texture stage (`../texture.rs`,
//! `source.rs`), the HLOD bake's materials and the displacement's height maps: a texture whose only image is an extension's is read by all alike.
use serde_json::Value;

/// The image a texture shows, the one the table publishes: the WebP, then the AVIF source
/// an extension declares (a texture may carry no other), else the core `source`.
pub(crate) fn texture_image(texture: &Value) -> Option<u64> {
    ["EXT_texture_webp", "EXT_texture_avif"]
        .iter()
        .find_map(|name| texture.pointer(&format!("/extensions/{name}/source")))
        .or_else(|| texture.get("source"))
        .and_then(Value::as_u64)
}

/// The sampler `texture` names, none for a texture that names none.
pub(crate) fn sampler_of<'g>(g: &'g Value, texture: &Value) -> Option<&'g Value> {
    let id = texture.get("sampler").and_then(Value::as_u64)?;
    g.get("samplers")?.as_array()?.get(id as usize)
}

/// The wrap mode code the sampler of `texture` names along `key` (`wrapS`, `wrapT`): none for a
/// texture with no sampler and for a sampler that names none, which repeat.
pub(crate) fn sampler_wrap(g: &Value, texture: &Value, key: &str) -> Option<u64> {
    sampler_of(g, texture)?.get(key)?.as_u64()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Behaviour: an extension's image is the one a texture shows, WebP before AVIF before the core
    // source, and a texture that has an extension's alone shows it.
    #[test]
    fn a_texture_shows_the_image_of_its_extension_before_its_source() {
        let texture = |extensions: Value, source: Option<u64>| {
            let mut t = json!({ "extensions": extensions });
            if let Some(source) = source {
                t["source"] = json!(source);
            }
            t
        };
        let webp = json!({"EXT_texture_webp": {"source": 1}});
        let avif = json!({"EXT_texture_avif": {"source": 2}});
        let both = json!({"EXT_texture_avif": {"source": 2}, "EXT_texture_webp": {"source": 1}});
        assert_eq!(texture_image(&texture(webp, None)), Some(1));
        assert_eq!(texture_image(&texture(avif, Some(0))), Some(2));
        assert_eq!(texture_image(&texture(both, Some(0))), Some(1));
        assert_eq!(texture_image(&json!({"source": 3})), Some(3));
        assert_eq!(texture_image(&json!({})), None);
    }

    // Behaviour: the wrap a sampler names is read by key; no sampler, or one that names none, names
    // none.
    #[test]
    fn a_sampler_names_the_wrap_of_each_axis() {
        let g = json!({"samplers": [{"wrapS": 33071}, {}]});
        let wrap = |sampler: Option<u64>, key| {
            let texture = sampler.map_or(json!({}), |s| json!({"sampler": s}));
            sampler_wrap(&g, &texture, key)
        };
        assert_eq!(wrap(Some(0), "wrapS"), Some(33071));
        assert_eq!(wrap(Some(0), "wrapT"), None);
        assert_eq!((wrap(Some(1), "wrapS"), wrap(None, "wrapS")), (None, None));
    }
}
