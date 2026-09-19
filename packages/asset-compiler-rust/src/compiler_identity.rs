//! Identity of the compiled product: what the cache key is made of, and nothing else.
//!
//! The key names a cache folder that consumers reuse without rereading it. It must
//! therefore keep two opposite promises: two compilations that would yield the same
//! bytes carry the same key, and two that would yield different bytes carry two.
//! An import manifest hashed as-is betrayed the first — it carries the conversion
//! timing and the path of the machine that did it, which two runs never agree on.
//! Linked images of the scene, read later for previews, betrayed the second —
//! their pixels enter the sidecar without entering the identity that names it.
//!
//! Identity is therefore built in two parts: what the source declares, stripped of
//! its timings and run provenance, and the fingerprint of the resources compilation
//! actually consumes — the geometry binary and each image file the scene cites.
use super::*;

/// Fields a manifest carries for operations, not identity: a measured time, the
/// path of the converting machine. They are stripped at every level — a per-input
/// record carries its own — and the rest enters the key, including what a driver
/// will add tomorrow: forgetting to exclude tightens identity, forgetting to
/// include would loosen it.
const VOLATILE: [&str; 4] = ["importMs", "ms", "parseMs", "path"];

/// Copies a value without its volatile fields, at every level.
fn stable(value: &Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .filter(|(name, _)| !VOLATILE.contains(&name.as_str()))
                .map(|(name, value)| (name.clone(), stable(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(stable).collect()),
        other => other.clone(),
    }
}

/// Images the scene cites by relative URI, in its order, with the fingerprint of
/// the file found. `null` means absence: an image that appears changes identity as
/// much as one whose bytes change. Embedded images are not here — their bytes are
/// already those of the binary.
fn linked_images(g: &Value, image_root: &Path) -> Vec<Value> {
    let Some(images) = g.get("images").and_then(Value::as_array) else {
        return Vec::new();
    };
    images
        .iter()
        .filter_map(|image| {
            let uri = image.get("uri").and_then(Value::as_str)?;
            let path = crate::uri::resolve_under(image_root, uri).ok()?;
            Some(json!({"uri":uri,"sha256":hash_file(&path).ok()}))
        })
        .collect()
}

/// Cache key: identity of the source, of the resources it consumes, and the
/// options that decide the product. A consumer that reuses by this key finds the
/// same bytes. `image_root` is the root where relative image URIs resolve, named
/// by the router. `cutouts` is what an answer has REALLY changed in the scene:
/// bindings reclassified as cutout, which change how their primitives are ranked
/// and therefore the product bytes. An answer with no effect — "glass", refusal,
/// a texture the scene does not use — does not move the key.
pub(super) fn cache_key(
    o: &Options,
    loaded: &RuntimeSource,
    image_root: &Path,
    cutouts: &[Value],
) -> Result<String> {
    let source = hash(&serde_json::to_vec(&stable(&loaded.manifest))?);
    let images = linked_images(&loaded.g, image_root);
    let bin_hash = &loaded.bin_hash;
    let material = json!({
        "source":source,"binary":bin_hash,"images":images,
        "compiler":COMPILER_VERSION,"implementation":implementation_hash(),
        "plugins":plugins::fingerprint(),"scope":o.scope,"budget":o.triangle_budget,
        "resourceBase":o.resource_base,"simplification":o.simplification,
        "errorModel":DAG_ERROR_MODEL,"cutouts":cutouts,
    });
    Ok(hash(serde_json::to_string(&material)?.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Behaviour: a measured time or a machine path leaves identity, at every
    // level; the rest of the manifest enters as-is.
    #[test]
    fn les_mesures_et_la_provenance_sortent_de_lidentite() {
        let manifest = json!({"runtime":{"sha256":"abc"},
            "source":{"plugin":"usd","path":"/chez/moi/s.usd","importMs":12.5,
                "files":[{"file":"s.usd","sha256":"def","parseMs":3.0,"ms":4.0}]}});
        assert_eq!(
            stable(&manifest),
            json!({"runtime":{"sha256":"abc"},
                "source":{"plugin":"usd","files":[{"file":"s.usd","sha256":"def"}]}})
        );
    }
}
