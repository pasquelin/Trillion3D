use super::*;

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
    assert!(
        !directory.join("scene.gltf").exists(),
        "no second scene beside the pages"
    );
    assert_eq!(
        result["geometryPages"]["formatVersion"],
        trillion3d_page_codec::VERSION
    );
    assert_eq!(result["geometryPages"]["codec"], "quantized");
    let geometry = &result["primitives"][0]["pages"][0]["geometry"];
    assert!(geometry.get("formatVersion").is_none());
    let primitive = &result["primitives"][0];
    let page = geometry_page(&options.cache, &result, primitive, &primitive["pages"][0]);
    let decoded = trillion3d_page_codec::decode(&page, 1 << 20).expect("decode");
    assert_eq!(decoded.indices(), [0, 1, 2]);
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
    let mut manifest: Value = read_json(&manifest_path);
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

// Behaviour: a source whose mesh and primitive carry an `assembly` extra some other tool wrote — a
// name, an object of its own — compiles to the pages it compiles to without it, the option off.
#[test]
fn an_assembly_extra_of_another_tool_changes_nothing_where_assemblies_are_not_allowed() {
    let (root, options) = fixture();
    let plain = compile(&options, |_| {}).expect("compile");
    for extra in [json!("chassis"), json!({"id": 4})] {
        let mut gltf = read_gltf(&options);
        gltf["meshes"][0]["extras"] = json!({"assembly": extra});
        gltf["meshes"][0]["primitives"][0]["extras"] = json!({"assembly": extra});
        write_gltf(&options, &gltf, None);
        let told = compile(&options, |_| {}).expect("no job fails on the extra");
        // The same pages: the second job reuses the first's, so only that count differs.
        let pages = |v: &Value| {
            let mut v = v["primitives"].clone();
            for primitive in v.as_array_mut().into_iter().flatten() {
                primitive.as_object_mut().map(|p| p.remove("reusedPages"));
            }
            v
        };
        assert_eq!(pages(&told), pages(&plain), "{extra}");
    }
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a part is cooked once however many nodes of the assembly name it: the assembly's own
// triangle and the part make two primitives whether the part is placed 1, 10 or 100 times, their
// pages the same bytes, and the nodes are the scene's own, written under the nodes that place the
// assembly.
#[test]
fn a_part_is_cooked_once_however_many_nodes_place_it() {
    let cooked = |count: usize| {
        let (root, mut options) = fixture();
        options.mesh_build = MeshBuildOptions::read(Some(&json!({"allowAssemblies": true})));
        let mut gltf = read_gltf(&options);
        gltf["materials"] = json!([{}]);
        let window = gltf["meshes"][0].clone();
        gltf["meshes"].as_array_mut().expect("meshes").push(window);
        let nodes: Vec<Value> = (0..count)
            .map(|at| json!({"part": 0, "translation": [at, 0, 0]}))
            .collect();
        gltf["meshes"][0]["extras"] = json!({"assembly": {
            "parts": [{"mesh": 1, "materialRemap": [0]}], "nodes": nodes,
        }});
        write_gltf(&options, &gltf, None);
        let result = compile(&options, |_| {}).expect("compile");
        let key = result["key"].as_str().expect("key").to_string();
        let source = written_gltf(&options, &key);
        fs::remove_dir_all(root).expect("cleanup");
        (
            result["primitives"].clone(),
            source["nodes"].as_array().map(Vec::len),
        )
    };
    let (one, one_nodes) = cooked(1);
    for count in [10, 100] {
        let (many, many_nodes) = cooked(count);
        assert_eq!(many.as_array().map(Vec::len), Some(2), "{count}");
        assert_eq!(
            many, one,
            "the same two primitives, the same pages, {count}"
        );
        assert_eq!(many_nodes, Some(2 + 2 * count));
    }
    assert_eq!(one_nodes, Some(2 + 2));
}
