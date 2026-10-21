use super::*;
pub(super) fn fixture() -> (PathBuf, Options) {
    fixture_named("mesh.gltf", "mesh.bin")
}
pub(super) fn fixture_named(gltf_name: &str, bin_name: &str) -> (PathBuf, Options) {
    let buffer = json!({"uri":bin_name,"byteLength":48});
    let mut gltf = triangle_gltf(buffer, json!([{"mesh":0},{"mesh":0}]));
    gltf["materials"] = json!([]);
    gltf["images"] = json!([]);
    let bin = triangle_bin();
    let (root, source, cache) = write_fixture(gltf_name, (gltf_name, &gltf), (bin_name, &bin));
    let options = Options {
        scope: "slice".into(),
        ..options(source, cache)
    };
    (root, options)
}

/// The manifest of the key folder `directory`, read from its root through its pages.
pub(super) fn paged(directory: &Path) -> crate::compiler::pages::manifest::Paged {
    crate::compiler::pages::manifest::read_manifest_at(directory).expect("the manifest's pages")
}
/// The bytes of `page`'s geometry page, a page of `primitive` of `result`: read from its bundle in
/// the container it lies in, under `cache`.
pub(super) fn geometry_page(
    cache: &Path,
    result: &Value,
    primitive: &Value,
    page: &Value,
) -> Vec<u8> {
    let at = |value: &Value, key: &str| value[key].as_u64().expect(key) as usize;
    let bundle = &primitive["streams"]["pages"][at(page, "stream")];
    let file = &result["geometryFiles"][at(bundle, "file")]["sha256"];
    let path = objects_dir(cache).join(format!("{}.bin", file.as_str().expect("file")));
    let bytes = fs::read(path).expect("geometry file");
    let start = at(bundle, "offset") + at(page, "streamOffset");
    bytes[start..start + at(&page["geometry"], "bytes")].to_vec()
}
/// The digests of the geometry containers the manifest in `directory` names.
pub(super) fn geometry_files(directory: &Path) -> Vec<String> {
    let manifest = paged(directory).manifest;
    let files = manifest["geometryFiles"]
        .as_array()
        .expect("geometry files");
    files
        .iter()
        .map(|file| file["sha256"].as_str().expect("digest").to_string())
        .collect()
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

/// A tiny OBJ, one triangle, one material, and the library it cites, placed in a
/// named folder: that folder is what resolves the library.
pub(super) fn obj_source(root: &Path, folder: &str, mtl: &str) -> PathBuf {
    let source = root.join(folder);
    fs::create_dir_all(&source).expect("obj dir");
    fs::write(
        source.join("scene.obj"),
        "mtllib scene.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nusemtl Uni\nf 1//1 2//1 3//1\n",
    )
    .expect("obj");
    if !mtl.is_empty() {
        fs::write(source.join("scene.mtl"), mtl).expect("mtl");
    }
    source.join("scene.obj")
}

/// Compiles, and returns the result with the intermediate-scene key the driver's progress named.
pub(super) fn compile_with_import_key(options: &Options) -> (Value, String) {
    let keys = std::sync::Mutex::new(Vec::new());
    let result = compile(options, |report| {
        if report["phase"] == "import-source" {
            if let Some(key) = report["key"].as_str() {
                keys.lock().expect("keys").push(key.to_string());
            }
        }
    })
    .expect("compile obj");
    let key = keys.into_inner().expect("keys").pop().expect("a key");
    (result, key)
}

/// Compiles and returns the intermediate-scene key with what import wrote of it.
/// The key is read in the driver's progress: that is what the cache reuses, or not.
pub(super) fn import_key(options: &Options) -> (String, Value, Value) {
    let (_, key) = compile_with_import_key(options);
    let directory = options.cache.join("native").join("imports").join(&key);
    (
        key,
        read_json(&directory.join("model.gltf")),
        read_json(&directory.join("manifest.json")),
    )
}
