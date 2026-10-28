pub(super) use super::fixture_shapes::{cube_fixture, grid_fixture_displaced};
pub(crate) use super::fixture_shapes::{grid_indices, portable_sin, triangle_bin, triangle_gltf};
use super::*;

/// Writes `<tag>.gltf`, `<tag>.bin` and the manifest of a scene into a scratch source folder, its
/// mesh nodes and triangles counted from the document as the compiler counts them, and returns it
/// with the options every simplified fixture compiles with. The document's only buffer must name
/// `<tag>.bin`.
pub(super) fn gltf_fixture(tag: &str, gltf: &Value, bin: &[u8]) -> (PathBuf, Options) {
    let (gltf_name, bin_name) = (format!("{tag}.gltf"), format!("{tag}.bin"));
    let (root, source, cache) = write_fixture(tag, (&gltf_name, gltf), (&bin_name, bin));
    let options = Options {
        triangle_budget: 150000,
        simplification: "qem-endpoints".into(),
        ..options(source, cache)
    };
    (root, options)
}

/// Writes `gltf_name`, `bin_name` and the manifest of a scene into the source folder of a scratch
/// root named after `tag`, its mesh nodes and triangles counted from the document as the compiler
/// counts them: the root, its source and its cache folder.
pub(super) fn write_fixture(
    tag: &str,
    (gltf_name, gltf): (&str, &Value),
    (bin_name, bin): (&str, &[u8]),
) -> (PathBuf, PathBuf, PathBuf) {
    let (mesh_nodes, triangles) = source_stats(gltf).expect("source stats");
    let root = scratch("fixture", tag);
    let source = root.join("source");
    let cache = root.join("cache");
    fs::create_dir_all(&source).expect("source");
    let gltf_bytes = serde_json::to_vec(gltf).expect("gltf");
    fs::write(source.join(gltf_name), &gltf_bytes).expect("gltf write");
    fs::write(source.join(bin_name), bin).expect("bin write");
    let sidecars = [(bin_name.to_string(), hash(bin))];
    let manifest = runtime_manifest(
        gltf_name,
        &hash(&gltf_bytes),
        &sidecars,
        mesh_nodes,
        triangles,
    );
    let manifest_bytes = serde_json::to_vec(&manifest).expect("manifest");
    fs::write(source.join("manifest.json"), manifest_bytes).expect("manifest write");
    (root, source, cache)
}

/// The options a test compiles `source` into `cache` with, a field it needs changed by struct
/// update: the full scope, simplification off, a budget of one triangle, one thread, 64 MiB and
/// the BC family.
pub(crate) fn options(source: PathBuf, cache: PathBuf) -> Options {
    Options {
        source,
        cache,
        resource_base: "/assets/".into(),
        scope: "full".into(),
        triangle_budget: 1,
        threads: 1,
        ram_budget_mb: 64,
        simplification: "none".into(),
        texture_formats: vec![crate::texture::BlockFormat::Bc7],
        hlod: crate::Hlod::read(None),
        materials: crate::MaterialOptions::read(None, None, None),
        voxelize: crate::VoxelizeOptions::read(None),
        partition_grid: crate::PartitionGrid::read(&serde_json::Map::new()),
        mesh_build: crate::MeshBuildOptions::read(None),
        object_settings: crate::ObjectSettings::read(None),
        lightmap_bake: crate::LightmapBakeOptions::read(None),
        hair_strands: crate::HairOptions::read(None, None),
        cancelled: Arc::new(AtomicBool::new(false)),
    }
}

/// The chain the world tests build: HLOD 0 instanced, then three approximated layers whose meshes
/// get a cluster DAG (`clusterDag`, off by default), each building the next's actors on a grid
/// twice as coarse, the last always loaded, every placed object in it.
pub(crate) fn hlod_chain() -> crate::Hlod {
    let chain = serde_json::json!({
        "layers": [
            {"name": "hlod0", "builder": "instanced", "parent": "hlod1"},
            {"name": "hlod1", "builder": "approximate", "parent": "hlod2", "cellSize": 512,
                "loadingRange": 1024, "clusterDag": true},
            {"name": "hlod2", "builder": "approximate", "parent": "hlod3", "cellSize": 1024,
                "loadingRange": 2048, "clusterDag": true},
            {"name": "hlod3", "builder": "approximate", "spatiallyLoaded": false, "clusterDag": true}
        ],
        "default": "hlod0"
    });
    crate::Hlod::read(Some(&chain)).expect("the chain reads")
}

/// `options` for a source folder that holds its own cache, in `cache` beside the files.
pub(crate) fn options_in(source: &Path) -> Options {
    options(source.to_path_buf(), source.join("cache"))
}

/// The JSON document at `path`.
pub(crate) fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).expect("read")).expect("json")
}

/// The values of accessor `rank` of `gltf` over `bin`, flat, read by the compiler's one reader
/// (`collect_f32`): its offsets, stride and sparse replacement as the document declares them.
pub(crate) fn accessor_floats(gltf: &Value, bin: &[u8], rank: usize) -> Vec<f32> {
    let values = accessor(gltf, bin, rank, None).expect("accessor");
    values.collect_f32().expect("floats")
}

/// The indices of accessor `rank` of `gltf` over `bin`, read by the compiler's one reader
/// (`collect_u32`) at the width their component declares.
pub(crate) fn accessor_indices(gltf: &Value, bin: &[u8], rank: usize) -> Vec<u32> {
    let values = accessor(gltf, bin, rank, None).expect("accessor");
    values.collect_u32().expect("indices")
}

pub(crate) fn encode_glb(gltf: &Value, bin: &[u8]) -> Vec<u8> {
    let mut json = serde_json::to_vec(gltf).expect("json");
    while !json.len().is_multiple_of(4) {
        json.push(b' ');
    }
    let mut blob = bin.to_vec();
    while !blob.len().is_multiple_of(4) {
        blob.push(0);
    }
    let total = 12 + 8 + json.len() + 8 + blob.len();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&0x46546C67u32.to_le_bytes());
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(&(blob.len() as u32).to_le_bytes());
    out.extend_from_slice(&0x004E4942u32.to_le_bytes());
    out.extend_from_slice(&blob);
    out
}
pub(super) fn obj_fixture(name: &str, mtl: bool) -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let source = root.join("obj");
    fs::create_dir_all(&source).expect("obj dir");
    let mut obj = String::from(
        "v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvn 0 0 1\nvt 0 0\nvt 1 0\nvt 0 1\nvt 1 1\n",
    );
    if mtl {
        obj.push_str("mtllib quad.mtl\nusemtl painted\n");
        fs::write(
            source.join("quad.mtl"),
            "newmtl painted\nKd 0.2 0.4 0.6\nd 0.5\nmap_Kd textures/paint.png\n",
        )
        .expect("mtl");
        fs::create_dir_all(source.join("textures")).expect("textures");
        fs::write(
            source.join("textures/paint.png"),
            b"\x89PNG\r\n\x1a\nnot-a-real-png",
        )
        .expect("png");
    }
    obj.push_str("f 1/1/1 2/2/1 4/4/1 3/3/1\n");
    fs::write(source.join(name), obj).expect("obj write");
    options.source = source.join(name);
    options.scope = "full".into();
    options.triangle_budget = 150000;
    (root, options)
}

/// The two slopes of a symmetric roof, of length one: the flat normal of each of its faces,
/// shared by every driver test that reads smoothing off such a roof.
pub(crate) const ROOF_LEFT: [f32; 3] = [
    -std::f32::consts::FRAC_1_SQRT_2,
    0.0,
    std::f32::consts::FRAC_1_SQRT_2,
];
pub(crate) const ROOF_RIGHT: [f32; 3] = [
    std::f32::consts::FRAC_1_SQRT_2,
    0.0,
    std::f32::consts::FRAC_1_SQRT_2,
];

/// The regular files left anywhere under `dir`.
pub(crate) fn files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for path in entries.flatten().map(|entry| entry.path()) {
        if path.is_dir() {
            out.extend(files(&path));
        } else {
            out.push(path);
        }
    }
    out
}
