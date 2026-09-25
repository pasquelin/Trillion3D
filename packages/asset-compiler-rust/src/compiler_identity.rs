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
        "textureFormats":o.texture_formats.iter().map(|f| f.name()).collect::<Vec<_>>(),
        "errorModel":DAG_ERROR_MODEL,"cutouts":cutouts,
    });
    keyed(material, crate::physics_cook::JOLT_COMMIT)
}

/// The key of `material` once the physics cook is named in it: the stage's version and the Jolt
/// commit it links, whose binary state the cooked shapes are. A cache cooked by another Jolt is
/// another key, never reused.
fn keyed(mut material: Value, jolt: &str) -> Result<String> {
    material["jolt"] = json!(jolt);
    material["physicsCook"] = json!(crate::physics_cook::PHYSICS_COOK_VERSION);
    Ok(hash(serde_json::to_string(&material)?.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Behaviour: the build script watches the source directory itself. Watched file by file, a
    // module created after the previous run is in no watch list, the script does not rerun and
    // the next build keeps the previous `implementation_hash` — a cache key that stands still
    // while the compiler moves. The stale reuse #290 hit came from the cook running a binary it
    // never rebuilt (#291); this is the same shape, one build earlier, and is closed here.
    #[test]
    fn the_build_script_watches_the_source_folder() {
        assert!(include_str!("../build.rs").contains("cargo:rerun-if-changed=src\""));
    }

    // Behaviour: the page codec is linked into the compiler: its sources are hashed as the
    // compiler's own, so a codec edit moves the key (#558). Read from the list the build hashed.
    #[test]
    fn the_build_hashes_the_page_codec() {
        let inputs: Vec<&str> =
            include_str!(concat!(env!("OUT_DIR"), "/implementation_inputs.txt"))
                .lines()
                .collect();
        for input in [
            "../page-codec-wasm/src/lib.rs",
            "../page-codec-wasm/Cargo.toml",
        ] {
            assert!(inputs.contains(&input), "{input} is not hashed");
        }
        assert!(inputs.contains(&"src/compiler_identity.rs"));
    }

    // Behaviour: the runtime reads the error model the compiler writes. A mismatch would make
    // every fresh cache STALE_CACHE, or let a stale one through.
    #[test]
    fn the_runtime_names_the_same_error_model() {
        let contract = include_str!("../../sdk-core/src/contracts/base.ts");
        let line = format!("export const DAG_ERROR_MODEL = '{DAG_ERROR_MODEL}';");
        assert!(
            contract.contains(&line),
            "sdk-core does not declare {DAG_ERROR_MODEL}"
        );
    }

    // Behaviour: shapes cooked by another Jolt are another product: the key moves with the commit.
    #[test]
    fn another_jolt_is_another_key() {
        let material = json!({"source":"abc"});
        let ours = keyed(material.clone(), crate::physics_cook::JOLT_COMMIT).unwrap();
        assert_ne!(ours, keyed(material, &"0".repeat(40)).unwrap());
    }

    // Behaviour: a measured time or a machine path leaves identity, at every
    // level; the rest of the manifest enters as-is.
    #[test]
    fn measures_and_provenance_leave_the_identity() {
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
