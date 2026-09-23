//! Digest pieces several golden families fix the same way: the identity of the compiled
//! scene, the driver chain a container publishes, and the tables a driver that writes its own
//! intermediate scene leaves in it. A family adds what is its own on top, never its own copy.
use super::*;

/// Identity of the compiled scene: format, sidecar version and bytes, and the counts the
/// compiler kept. `extra` holds the fields the family fixes beside them.
pub(super) fn compiled_identity(run: &GoldenRun, extra: Value) -> Value {
    let mut digest = json!({
      "formatVersion": run.result["formatVersion"],
      "manifestBinaryVersion": run.slim["binary"]["version"],
      "sidecarSha256": hash(&run.binary),
      "primitives": run.result["primitives"].as_array().expect("primitives").len(),
      "selectedNodes": run.result["selectedNodes"],
      "totalNodes": run.result["totalNodes"],
      "selectedTriangles": run.result["selectedTriangles"],
      "sourceTriangles": run.result["sourceTriangles"],
    });
    for (field, value) in extra.as_object().expect("extra fields") {
        digest[field] = value.clone();
    }
    digest
}

/// Container -> inner driver chain, as the container published it in the report.
pub(super) fn chain_report(run: &GoldenRun) -> Value {
    run.reports
        .iter()
        .find(|report| report["phase"] == "archive" && report["step"] == "routed")
        .map(|report| report["chain"].clone())
        .expect("the container publishes the driver chain")
}

/// `scene_digest` of a driver that writes its own intermediate scene, plus the tables it wrote
/// and what the compiler kept of them; `files` gives the per-file record as the family fixes it.
/// Returns the digest and the driver's manifest.
pub(super) fn tables_digest(
    run: &GoldenRun,
    plugin: &str,
    files: impl Fn(&Value) -> Value,
) -> (Value, Value) {
    let (mut out, manifest, gltf) = scene_digest(run, plugin);
    for (field, value) in [
        ("scenePlugin", run.result["scenePlugin"].clone()),
        ("meshes", gltf["meshes"].clone()),
        ("materials", gltf["materials"].clone()),
        ("images", gltf["images"].clone()),
        ("samplers", gltf["samplers"].clone()),
        ("textures", gltf["textures"].clone()),
        ("accessors", gltf["accessors"].clone()),
        ("files", files(&manifest["source"]["files"])),
        ("sidecarSha256", json!(hash(&run.binary))),
        ("selectedNodes", run.result["selectedNodes"].clone()),
        ("sourceTriangles", run.result["sourceTriangles"].clone()),
    ] {
        out[field] = value;
    }
    (out, manifest)
}
