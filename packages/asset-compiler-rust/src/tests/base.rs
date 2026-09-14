use super::*;
use std::sync::atomic::AtomicU64;
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_FIXTURE_ID: AtomicU64 = AtomicU64::new(0);
pub(super) fn fixture() -> (PathBuf, Options) {
    fixture_named("mesh.gltf", "mesh.bin")
}
pub(super) fn fixture_named(gltf_name: &str, bin_name: &str) -> (PathBuf, Options) {
    let root = std::env::temp_dir().join(format!(
        "web-geometry-{}-{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos(),
        NEXT_FIXTURE_ID.fetch_add(1, Ordering::Relaxed),
        gltf_name
    ));
    let source = root.join("source");
    let cache = root.join("cache");
    fs::create_dir_all(&source).expect("source");
    let mut bin = Vec::new();
    for value in [0f32, 0., 0., 1., 0., 0., 0., 1., 0.] {
        bin.extend_from_slice(&value.to_le_bytes())
    }
    for value in [0u32, 1, 2] {
        bin.extend_from_slice(&value.to_le_bytes())
    }
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":bin_name,"byteLength":48}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36},{"buffer":0,"byteOffset":36,"byteLength":12}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":3},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":3}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0},{"mesh":0}],"materials":[],"images":[]});
    let gltf_bytes = serde_json::to_vec(&gltf).expect("gltf");
    fs::write(source.join(gltf_name), &gltf_bytes).expect("gltf write");
    fs::write(source.join(bin_name), &bin).expect("bin write");
    fs::write(source.join("manifest.json"),serde_json::to_vec(&json!({"status":"ready","formatVersion":FORMAT_VERSION,"runtime":{"file":gltf_name,"sha256":hash(&gltf_bytes),"sidecars":[{"file":bin_name,"sha256":hash(&bin)}],"trianglesAcrossNodes":2,"meshNodes":2}})).expect("manifest")).expect("manifest write");
    let options = Options {
        source,
        cache,
        resource_base: "/assets/".into(),
        scope: "slice".into(),
        triangle_budget: 1,
        threads: 1,
        ram_budget_mb: 64,
        simplification: "none".into(),
        cancelled: Arc::new(AtomicBool::new(false)),
    };
    (root, options)
}

pub(super) fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).expect("read")).expect("json")
}
/// The fixture's glTF as JSON, for a test that alters it before writing it back.
pub(super) fn read_gltf(options: &Options) -> Value {
    read_json(&options.source.join("mesh.gltf"))
}
/// Writes the altered glTF back and restamps the manifest hashes; `bin` when the sidecar changed too.
pub(super) fn write_gltf(options: &Options, gltf: &Value, bin: Option<&[u8]>) -> Vec<u8> {
    let gltf_bytes = serde_json::to_vec(gltf).expect("encode");
    fs::write(options.source.join("mesh.gltf"), &gltf_bytes).expect("write");
    let manifest_path = options.source.join("manifest.json");
    let mut manifest = read_json(&manifest_path);
    manifest["runtime"]["sha256"] = json!(hash(&gltf_bytes));
    if let Some(bin) = bin {
        manifest["runtime"]["sidecars"][0]["sha256"] = json!(hash(bin));
    }
    let manifest_bytes = serde_json::to_vec(&manifest).expect("encode");
    fs::write(&manifest_path, &manifest_bytes).expect("write");
    manifest_bytes
}
/// The glTF the compiler copied into the cache slice it wrote under `key`.
pub(super) fn written_gltf(options: &Options, key: &str) -> Value {
    read_json(
        &options
            .cache
            .join("native/slice")
            .join(key)
            .join("source.gltf"),
    )
}
