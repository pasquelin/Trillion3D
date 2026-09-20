//! Fast path (#47): a job whose product is already in the cache proves the folder
//! and keeps it, instead of rebuilding the DAG to write the same bytes again.
use super::identite_textures::{png_sized, source_texturee};
use super::*;

/// A textured fixture whose image is wide enough to bake one level file, so the
/// proof has every kind of product to check: files, sidecar, objects, levels.
fn textured() -> (PathBuf, Options) {
    let (root, options, image) = source_texturee();
    fs::write(&image, png_sized(128, [255, 0, 0, 255])).expect("image");
    (root, options)
}

/// Compiles and returns the result with the `reuse` progress events it announced.
fn compile_with_events(options: &Options) -> (Value, Vec<Value>) {
    let events = std::sync::Mutex::new(Vec::new());
    let result = compile(options, |event| {
        if event["phase"] == "reuse" {
            events.lock().expect("events").push(event);
        }
    })
    .expect("compile");
    (result, events.into_inner().expect("events"))
}

fn key_directory(options: &Options, key: &str) -> PathBuf {
    options.cache.join("native").join(&options.scope).join(key)
}

// Behaviour: the same inputs and options a second time reuse the folder — the
// DAG is not rebuilt, the manifest on disk is untouched, the pointer names the
// folder, and the result says what was proven.
#[test]
fn identical_fingerprint_reuses_the_folder_without_rebuilding() {
    let (root, options) = textured();
    let (first, first_events) = compile_with_events(&options);
    assert!(first_events.is_empty(), "nothing to reuse on a fresh cache");
    let key = first["key"].as_str().expect("key");
    let manifest_path = key_directory(&options, key).join("clusters.json");
    let written = fs::read(&manifest_path).expect("manifest");
    let (second, events) = compile_with_events(&options);
    assert_eq!(second["key"], first["key"]);
    assert_eq!(events.len(), 1, "one reuse event: {events:?}");
    assert_eq!(
        events[0]["completed"], 1,
        "the folder is proven: {events:?}"
    );
    let report = &second["reused"];
    assert!(
        report["objects"].as_u64().unwrap() > 0,
        "objects proven: {report}"
    );
    assert_eq!(
        report["textureLevels"], 1,
        "one baked level proven: {report}"
    );
    // source.gltf, source.bin, proxy.bin, lights.json, scene.gltf, scene.bin.
    assert_eq!(report["files"], 6, "every product recorded: {report}");
    assert!(
        second["metrics"]["clusterHierarchyPagesMs"].is_null(),
        "no DAG built"
    );
    assert!(second["metrics"]["wallMs"].as_f64().unwrap() > 0.0);
    assert_eq!(
        fs::read(&manifest_path).expect("manifest"),
        written,
        "manifest untouched"
    );
    let pointer = read_json(&options.cache.join("native/slice/manifest.json"));
    assert_eq!(pointer["key"], first["key"]);
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a changed source is another product — nothing is reused.
#[test]
fn changed_source_recompiles() {
    let (root, options) = textured();
    let (first, _) = compile_with_events(&options);
    let mut gltf = read_gltf(&options);
    gltf["nodes"] = json!([{"mesh":0}]);
    write_gltf(&options, &gltf, None);
    let (second, events) = compile_with_events(&options);
    assert_ne!(second["key"], first["key"]);
    assert!(
        second["reused"].is_null() && events.is_empty(),
        "{events:?}"
    );
    assert!(second["metrics"]["clusterHierarchyPagesMs"].is_number());
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: an option that shapes the product — the triangle budget — is another
// product too.
#[test]
fn changed_threshold_recompiles() {
    let (root, options) = textured();
    let (first, _) = compile_with_events(&options);
    let wider = Options {
        triangle_budget: 2,
        ..options.clone()
    };
    let (second, events) = compile_with_events(&wider);
    assert_ne!(second["key"], first["key"]);
    assert!(
        second["reused"].is_null() && events.is_empty(),
        "{events:?}"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a folder under this key written by another compiler version is not
// this job's product: refused with its reason, then rebuilt.
#[test]
fn another_compiler_version_under_the_key_recompiles() {
    let (root, options) = textured();
    let (first, _) = compile_with_events(&options);
    let manifest_path =
        key_directory(&options, first["key"].as_str().unwrap()).join("clusters.json");
    let mut manifest = read_json(&manifest_path);
    manifest["compilerVersion"] = json!("0.0.1");
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).expect("tamper");
    let (second, events) = compile_with_events(&options);
    assert_eq!(second["key"], first["key"]);
    assert!(second["reused"].is_null(), "not reused");
    assert_eq!(events[0]["completed"], 0);
    assert_eq!(
        events[0]["reason"],
        "manifest compilerVersion is not this job's"
    );
    assert_eq!(
        read_json(&manifest_path)["compilerVersion"],
        COMPILER_VERSION,
        "rebuilt"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a folder that fails one check — a corrupted object, sidecar or
// recorded file, a missing level — is refused with the reason, and rebuilt whole.
#[test]
fn corrupted_entry_is_rejected_and_rebuilt() {
    let (root, options) = textured();
    let (first, _) = compile_with_events(&options);
    let directory = key_directory(&options, first["key"].as_str().unwrap());
    let native = options.cache.join("native");
    let sidecar = fs::read(directory.join(MANIFEST_BINARY_FILE)).expect("sidecar");
    let object = manifest_binary::digests(&sidecar)
        .expect("digests")
        .remove(0);
    let (level_sha, kind, _) = manifest_binary::texture_levels(&sidecar)
        .expect("levels")
        .remove(0);
    let level = native.join(texture_preview::level_path(
        &level_sha,
        texture_preview::AtlasKind::from_word(kind).unwrap(),
        0,
    ));
    let object_path = native.join("objects").join(format!("{object}.bin"));
    let corruptions: [(&str, PathBuf, Option<&[u8]>); 4] = [
        (
            "does not match its name",
            object_path.clone(),
            Some(b"corrupt"),
        ),
        (
            "sidecar does not match",
            directory.join(MANIFEST_BINARY_FILE),
            Some(b"corrupt"),
        ),
        (
            "source.bin is",
            directory.join("source.bin"),
            Some(b"corrupt"),
        ),
        ("texture level", level.clone(), None),
    ];
    for (reason, path, bytes) in corruptions {
        let intact = fs::read(&path).expect("product");
        match bytes {
            Some(bytes) => fs::write(&path, bytes).expect("corrupt"),
            None => fs::remove_file(&path).expect("remove"),
        }
        let (second, events) = compile_with_events(&options);
        assert!(second["reused"].is_null(), "{reason}: not reused");
        let announced = events[0]["reason"].as_str().unwrap();
        assert!(announced.contains(reason), "{reason}: {announced}");
        assert_eq!(
            fs::read(&path).expect("rebuilt"),
            intact,
            "{reason}: rebuilt whole"
        );
    }
    let (third, events) = compile_with_events(&options);
    assert_eq!(events[0]["completed"], 1, "whole again, reused: {events:?}");
    assert_eq!(third["key"], first["key"]);
    fs::remove_dir_all(root).expect("cleanup");
}
