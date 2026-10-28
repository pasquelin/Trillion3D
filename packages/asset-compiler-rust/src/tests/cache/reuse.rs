//! Fast path: a job whose product is already in the cache proves the folder
//! and keeps it, instead of rebuilding the DAG to write the same bytes again.
use super::*;
use crate::plugins::scene::convert::f32_bytes;
use crate::tests::textures::identity_textures::{png_sized, source_texturee};

/// A textured fixture whose image is wide enough to bake one level file, so the
/// proof has every kind of product to check: files, sidecar, objects, levels.
pub(in crate::tests) fn textured() -> (PathBuf, Options) {
    let (root, options, image) = source_texturee();
    fs::write(&image, png_sized(128, [255, 0, 0, 255])).expect("image");
    (root, options)
}

/// Compiles and returns the result with the `reuse` progress events it announced.
pub(in crate::tests) fn compile_with_events(options: &Options) -> (Value, Vec<Value>) {
    let events = std::sync::Mutex::new(Vec::new());
    let result = compile(options, |event| {
        if event["phase"] == "reuse" {
            events.lock().expect("events").push(event);
        }
    })
    .expect("compile");
    (result, events.into_inner().expect("events"))
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
    let manifest_path = options.key_directory(key).join("clusters.json");
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
        "one baked level proven, in the stored blocks: {report}"
    );
    // source.gltf, source.bin, lights.json, scene-tables.json, physics.json, voxels.bin,
    // distanceFields.bin, meshCards.bin and rayTracing.bin: a mesh builds its field, its cards and
    // its tree for the rays unless told not to; and the head's preview-pixels file.
    assert_eq!(report["files"], 10, "every product recorded: {report}");
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
    let manifest_path = options
        .key_directory(first["key"].as_str().unwrap())
        .join("clusters.json");
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

// Behaviour: a warm reuse keeps everything its manifest names — the physics shapes as much as the
// geometry containers —: the proof hashes the objects, and the prune that follows it removes none.
#[test]
fn a_reused_folder_keeps_its_physics_shapes() {
    let (root, options) = repeated_grid(32);
    let (first, _) = compile_with_events(&options);
    let shape = first["physics"]["objects"][0]["sha256"]
        .as_str()
        .expect("digest");
    let mut named = BTreeSet::new();
    crate::compiler::cache::prune::referenced_objects(&first, &mut named);
    assert!(named.contains(shape), "{named:?}");
    let (second, events) = compile_with_events(&options);
    assert_eq!(events[0]["completed"], 1, "reused: {events:?}");
    assert_eq!(
        second["reused"]["objects"],
        named.len(),
        "every object proven"
    );
    assert!(
        object_path(&options, shape).is_file(),
        "object {shape} pruned after the reuse"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

/// Placements a side of the square the mesh is laid on, and the gap between two, metres.
const SIDE: usize = 4;
const GAP: f32 = 4000.0;

/// A rolling grid of `n`² cells (`2n²` triangles, a DAG that climbs to a few roots), its one mesh
/// placed `SIDE`² times over a square `GAP` apart.
fn repeated_grid(n: usize) -> (PathBuf, Options) {
    let mut positions = Vec::new();
    for y in 0..=n {
        for x in 0..=n {
            let height = portable_sin(x as f32 * 0.31) * portable_sin(y as f32 * 0.27) * 3.0;
            positions.extend([x as f32, height, y as f32]);
        }
    }
    let indices = grid_indices(n, n, |x, y| (y * (n + 1) + x) as u32);
    let mut bin = f32_bytes(&positions);
    bin.extend(indices.iter().flat_map(|v| v.to_le_bytes()));
    let (positions_bytes, index_bytes) = (positions.len() * 4, indices.len() * 4);
    let nodes: Vec<Value> = (0..SIDE * SIDE)
        .map(|k| json!({"mesh":0,"translation":[(k % SIDE) as f32 * GAP, 0.0, (k / SIDE) as f32 * GAP]}))
        .collect();
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"rolling.bin","byteLength":bin.len()}],
        "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":positions_bytes},
            {"buffer":0,"byteOffset":positions_bytes,"byteLength":index_bytes}],
        "accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":positions.len()/3},
            {"bufferView":1,"componentType":5125,"type":"SCALAR","count":indices.len()}],
        "meshes":[{"name":"rolling","primitives":[{"attributes":{"POSITION":0},"indices":1}]}],
        "nodes":nodes,"scenes":[{"nodes":(0..SIDE * SIDE).collect::<Vec<_>>()}],"scene":0});
    gltf_fixture("rolling", &gltf, &bin)
}
