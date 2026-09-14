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
    fs::write(source.join("manifest.json"),serde_json::to_vec(&json!({"status":"ready","formatVersion":SOURCE_FORMAT_VERSION,"runtime":{"file":gltf_name,"sha256":hash(&gltf_bytes),"sidecars":[{"file":bin_name,"sha256":hash(&bin)}],"trianglesAcrossNodes":2,"meshNodes":2}})).expect("manifest")).expect("manifest write");
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
