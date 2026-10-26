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
    let decoded =
        PrimitivePages::new(&options.cache, &result, primitive).decoded(&primitive["pages"][0]);
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

// Behaviour: a part is cooked once however many nodes of the assembly name it, and the levels above
// its instances grow with their number alone: the assembly's own triangle and the part make the
// same two primitives, the same pages, whether the part is placed 1, 10 or 100 times; from two
// instances on, the levels above their roots are the pages of a third primitive of the assembly's
// mesh (no triangle of its own), each instance carrying the error and the ball of its group in the
// node tables (`rootParents`); the nodes are the scene's own, written under the nodes that place the
// assembly. The bytes and the time of each count are printed (`--nocapture`).
#[test]
fn a_part_is_cooked_once_however_many_nodes_place_it() {
    let cooked = |count: usize| {
        let (root, mut options) = fixture();
        options.mesh_build = MeshBuildOptions::read(Some(&json!({"allowAssemblies": true})));
        // The levels above the instances exist where the build makes coarse levels, and the node
        // tables carry each instance's parent where the scene is published whole.
        options.simplification = "qem-endpoints".into();
        options.scope = "full".into();
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
        let started = std::time::Instant::now();
        let result = compile(&options, |_| {}).expect("compile");
        let millis = started.elapsed().as_secs_f64() * 1e3;
        let key = result["key"].as_str().expect("key").to_string();
        let source = written_gltf(&options, &key);
        // Each primitive's pages: their bytes and the triangles they draw.
        let sizes: Vec<(usize, usize)> = (result["primitives"].as_array().into_iter().flatten())
            .map(|primitive| {
                let pages = primitive["pages"].as_array().into_iter().flatten();
                let mut read = PrimitivePages::new(&options.cache, &result, primitive);
                pages.fold((0, 0), |(bytes, triangles), page| {
                    let raw = read.bytes(page);
                    let decoded = read.decoded(page);
                    (bytes + raw.len(), triangles + decoded.indices().len() / 3)
                })
            })
            .collect();
        println!("a part placed {count} times: {millis:.1} ms, (page bytes, triangles) {sizes:?}");
        let directory = options.key_directory(&key);
        let tables = read_json(&directory.join("scene-tables.json"));
        let mut rows: Vec<Value> = tables["nodes"].as_array().cloned().unwrap_or_default();
        for entry in fs::read_dir(&directory).expect("directory").flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("scene-cell-") {
                let cell = read_json(&entry.path());
                rows.extend(cell["nodes"].as_array().cloned().unwrap_or_default());
            }
        }
        let parented = rows
            .iter()
            .filter(|row| row.get("rootParents").is_some())
            .count();
        fs::remove_dir_all(root).expect("cleanup");
        let (carriers, others): (Vec<_>, Vec<_>) = (result["primitives"].as_array().expect("list"))
            .iter()
            .zip(&sizes)
            .partition(|(primitive, _)| primitive["triangles"] == 0);
        // What the scene decides of a page is not the part's cooking: its place in the shared file
        // follows the pages written before it (the carrier's levels, which grow with the count),
        // and its depth layer the surfaces sharing its plane (`coplanar`, bounded per plane). The
        // pages compared are their bytes and their records, not where they sit nor how they stack.
        let others: Vec<Value> = (others.iter())
            .map(|(p, size)| {
                let mut p = (*p).clone();
                for page in p["streams"]["pages"].as_array_mut().into_iter().flatten() {
                    page.as_object_mut().map(|fields| fields.remove("offset"));
                }
                for page in p["pages"].as_array_mut().into_iter().flatten() {
                    page.as_object_mut()
                        .map(|fields| fields.remove("depthLayer"));
                }
                json!([p, size])
            })
            .collect();
        let levels = carriers.first().map(|(_, (_, triangles))| *triangles);
        (
            others,
            levels,
            source["nodes"].as_array().map(Vec::len),
            parented,
        )
    };
    let (one, one_levels, one_nodes, one_parented) = cooked(1);
    assert_eq!(
        (one.len(), one_levels, one_parented),
        (2, None, 0),
        "a lone instance climbs nowhere"
    );
    assert_eq!(one_nodes, Some(2 + 2));
    let mut last = 0;
    for count in [10, 100] {
        let (others, levels, nodes, parented) = cooked(count);
        assert_eq!(
            others, one,
            "the same two primitives, the same pages, {count}"
        );
        let levels = levels.expect("the levels above the instances are pages of their own");
        assert!(
            levels >= count && levels > last,
            "{count}: {levels} triangles above them"
        );
        last = levels;
        assert_eq!(nodes, Some(2 + 2 * count));
        // Two nodes place the assembly, each with its `count` instances.
        assert_eq!(
            parented,
            2 * count,
            "every instance carries its group's error and ball"
        );
    }
}
