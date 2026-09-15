use super::*;

#[test]
fn parse_accepts_five_to_eight_args() {
    let cancelled = Arc::new(AtomicBool::new(false));
    let five = parse_compiler_args(
        &[
            "s".into(),
            "c".into(),
            "slice".into(),
            "12".into(),
            "/assets/".into(),
        ],
        cancelled.clone(),
    )
    .expect("five");
    assert_eq!(five.threads, 2);
    assert_eq!(five.ram_budget_mb, 256);
    assert_eq!(five.simplification, "none");
    let seven = parse_compiler_args(
        &[
            "s".into(),
            "c".into(),
            "full".into(),
            "12".into(),
            "4".into(),
            "128".into(),
            "/a/".into(),
        ],
        cancelled.clone(),
    )
    .expect("seven");
    assert_eq!(seven.threads, 4);
    assert_eq!(seven.ram_budget_mb, 128);
    let eight = parse_compiler_args(
        &[
            "s".into(),
            "c".into(),
            "full".into(),
            "12".into(),
            "4".into(),
            "128".into(),
            "/a/".into(),
            "qem-endpoints".into(),
        ],
        cancelled,
    )
    .expect("eight");
    assert_eq!(eight.simplification, "qem-endpoints");
    assert!(parse_compiler_args(
        &[
            "s".into(),
            "c".into(),
            "full".into(),
            "12".into(),
            "4".into(),
            "128".into(),
            "/a/".into(),
            "bicubic".into()
        ],
        Arc::new(AtomicBool::new(false))
    )
    .is_err());
    assert!(parse_compiler_args(
        &[
            "s".into(),
            "c".into(),
            "full".into(),
            "12".into(),
            "4".into(),
            "128".into(),
            "/a/".into(),
            "qem-endpoints".into(),
            "dag".into()
        ],
        Arc::new(AtomicBool::new(false))
    )
    .is_err());
}
#[test]
fn malformed_accessor_is_rejected() {
    let g = json!({"accessors":[{"bufferView":0,"componentType":5125,"type":"SCALAR","count":1}],"bufferViews":[{"buffer":0,"byteLength":4}]});
    assert!(accessor(&g, &[], 0, None).is_err());
}
#[test]
fn accessor_cannot_read_past_its_buffer_view() {
    let g = json!({"accessors":[{"bufferView":0,"componentType":5125,"type":"SCALAR","count":2}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":4}]});
    assert!(accessor(&g, &[0u8; 8], 0, None).is_err());
}
#[test]
fn compile_rejects_local_accessor_overflow_before_publication() {
    let (root, options) = fixture_named("mesh.gltf", "mesh.bin");
    let mut gltf = read_gltf(&options);
    gltf["bufferViews"][0]["byteLength"] = json!(24);
    write_gltf(&options, &gltf, None);
    assert_eq!(
        compile(&options, |_| {}).expect_err("accessor").code,
        "INVALID_GLTF"
    );
    assert!(!options.cache.join("native/slice/manifest.json").exists());
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_writes_pages_and_namespaced_pointer() {
    let (root, options) = fixture();
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["selectedTriangles"], 1);
    assert!(options.cache.join("native/slice/manifest.json").exists());
    let key = result["key"].as_str().expect("key");
    let directory = options.cache.join("native/slice").join(key);
    assert!(directory.join("source.gltf").exists());
    assert!(directory.join("scene.gltf").exists());
    let geometry = &result["primitives"][0]["pages"][0]["geometry"];
    assert_eq!(geometry["formatVersion"], 2);
    let page = fs::read(directory.join(geometry["url"].as_str().expect("page URL")))
        .expect("autonomous geometry page");
    let index_bytes = u32::from_le_bytes(page[24..28].try_into().expect("index bytes")) as usize;
    let indices: Vec<u16> =
        meshopt::decode_index_buffer(&page[32..32 + index_bytes], 3).expect("decode");
    assert_eq!(indices, [0, 1, 2]);
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_rejects_cancel_hash_and_format() {
    let (root, options) = fixture();
    options.cancelled.store(true, Ordering::Relaxed);
    assert_eq!(
        compile(&options, |_| {}).expect_err("cancel").code,
        "CANCELLED"
    );
    options.cancelled.store(false, Ordering::Relaxed);
    fs::write(options.source.join("mesh.bin"), [0u8; 48]).expect("corrupt");
    assert_eq!(
        compile(&options, |_| {}).expect_err("hash").code,
        "SOURCE_HASH_MISMATCH"
    );
    let manifest_path = options.source.join("manifest.json");
    let mut manifest: Value =
        serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");
    manifest["formatVersion"] = json!(999);
    fs::write(
        &manifest_path,
        serde_json::to_vec(&manifest).expect("encode"),
    )
    .expect("write");
    assert_eq!(
        compile(&options, |_| {}).expect_err("format").code,
        "UNSUPPORTED_FORMAT"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
