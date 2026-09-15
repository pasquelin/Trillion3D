use super::*;

#[test]
fn obj_source_is_imported_into_the_cache_then_compiled() {
    let (root, options) = obj_fixture("quad.obj", true);
    let events = std::sync::Mutex::new(Vec::new());
    let result = compile(&options, |e| events.lock().unwrap().push(e)).expect("compile obj");
    assert_eq!(result["selectedTriangles"], 2);
    let imports = options.cache.join("native/imports");
    let entries: Vec<_> = fs::read_dir(&imports)
        .expect("imports")
        .map(|e| e.expect("entry").path())
        .collect();
    assert_eq!(entries.len(), 1);
    let manifest: Value =
        serde_json::from_slice(&fs::read(entries[0].join("manifest.json")).expect("manifest"))
            .expect("json");
    assert_eq!(manifest["status"], "ready");
    assert_eq!(manifest["source"]["importer"], import::IMPORTER_VERSION);
    assert_eq!(manifest["runtime"]["trianglesAcrossNodes"], 2);
    assert_eq!(manifest["runtime"]["meshNodes"], 1);
    let gltf: Value =
        serde_json::from_slice(&fs::read(entries[0].join("model.gltf")).expect("gltf"))
            .expect("json");
    assert_eq!(
        gltf["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"][3],
        0.5
    );
    assert_eq!(gltf["materials"][0]["alphaMode"], "BLEND");
    assert_eq!(gltf["images"][0]["uri"], "textures/paint.png");
    assert!(
        gltf["meshes"][0]["primitives"][0]["attributes"]["TEXCOORD_0"]
            .as_u64()
            .is_some()
    );
    let steps: Vec<String> = events
        .lock()
        .unwrap()
        .iter()
        .filter(|e| e["phase"] == "import-source")
        .map(|e| e["step"].as_str().unwrap_or("").to_string())
        .collect();
    assert!(steps.contains(&"complete".to_string()), "{steps:?}");
    // A second run reuses the import and only recompiles when the compile key changed (it did not).
    let events = std::sync::Mutex::new(Vec::new());
    let again = compile(&options, |e| events.lock().unwrap().push(e)).expect("compile again");
    assert_eq!(again["key"], result["key"]);
    let steps: Vec<String> = events
        .lock()
        .unwrap()
        .iter()
        .filter(|e| e["phase"] == "import-source")
        .map(|e| e["step"].as_str().unwrap_or("").to_string())
        .collect();
    assert_eq!(steps, vec!["reused".to_string()]);
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn directory_of_importable_files_is_merged_into_one_scene() {
    let (root, options) = obj_fixture("a.obj", false);
    let dir = options.source.parent().expect("dir").to_path_buf();
    fs::copy(dir.join("a.obj"), dir.join("b.obj")).expect("copy");
    let options = Options {
        source: dir.clone(),
        ..options
    };
    assert!(matches!(source_kind(&dir).expect("kind"),SourceKind::Importable(ref v) if v.len()==2));
    let result = compile(&options, |_| {}).expect("compile dir");
    assert_eq!(result["selectedTriangles"], 4);
    assert_eq!(result["selectedNodes"].as_array().map(|a| a.len()), Some(2));
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn recompiling_prunes_stale_keys_and_orphan_objects() {
    let (root, options) = obj_fixture("quad.obj", false);
    let first = compile(&options, |_| {}).expect("first");
    let other = Options {
        simplification: "qem-endpoints".into(),
        ..options.clone()
    };
    let second = compile(&other, |_| {}).expect("second");
    assert_ne!(first["key"], second["key"]);
    let keys: Vec<_> = fs::read_dir(options.cache.join("native/full"))
        .expect("scope")
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .collect();
    assert_eq!(keys.len(), 1, "only the latest key survives");
    let mut referenced = BTreeSet::new();
    for p in second["primitives"].as_array().unwrap() {
        for page in p["pages"].as_array().unwrap() {
            referenced.insert(page["sha256"].as_str().unwrap().to_string());
            if let Some(g) = page["geometry"]["sha256"].as_str() {
                referenced.insert(g.to_string());
            }
        }
    }
    let objects: BTreeSet<String> = fs::read_dir(options.cache.join("native/objects"))
        .expect("objects")
        .filter_map(|e| e.ok())
        .map(|e| {
            e.file_name()
                .to_string_lossy()
                .trim_end_matches(".bin")
                .to_string()
        })
        .collect();
    assert!(
        referenced.is_subset(&objects),
        "every page of the surviving manifest is still on disk"
    );
    assert!(
        objects.len()
            <= referenced.len() + second["bundles"].as_array().map(|b| b.len()).unwrap_or(4),
        "orphans of the first key are gone: {} objects for {} pages",
        objects.len(),
        referenced.len()
    );
    // The pointer still resolves after pruning.
    let pointer: Value =
        serde_json::from_slice(&fs::read(options.cache.join("native/full/manifest.json")).unwrap())
            .unwrap();
    assert!(options
        .cache
        .join("native/full")
        .join(pointer["url"].as_str().unwrap())
        .exists());
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn pruning_one_scope_keeps_the_objects_the_other_scope_needs() {
    let (root, options) = obj_fixture("a.obj", false);
    let dir = options.source.parent().expect("dir").to_path_buf();
    fs::write(
        dir.join("b.obj"),
        "v 5 0 0\nv 7 0 0\nv 5 3 0\nvn 0 0 1\nf 1//1 2//1 3//1\n",
    )
    .expect("second mesh");
    let options = Options {
        source: dir,
        ..options
    };
    let full = compile(&options, |_| {}).expect("full");
    assert_eq!(full["selectedTriangles"], 3);
    let slice = Options {
        scope: "slice".into(),
        triangle_budget: 1,
        ..options.clone()
    };
    compile(&slice, |_| {}).expect("slice");
    // Every object the full manifest names must have survived the slice compile's pruning.
    let key = full["key"].as_str().unwrap();
    let dir = options.cache.join("native/full").join(key);
    assert!(dir.join("clusters.json").exists());
    let bin = fs::read(dir.join(MANIFEST_BINARY_FILE)).expect("bin");
    let mut digests = BTreeSet::new();
    referenced_objects(&json!({}), Some(&bin), &mut digests).expect("digests of the full scope");
    assert!(!digests.is_empty(), "binary columns carry the page digests");
    for digest in &digests {
        assert!(
            options
                .cache
                .join("native/objects")
                .join(format!("{digest}.bin"))
                .exists(),
            "object {digest} of the full scope was pruned by the slice compile"
        );
    }
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn gltf_sources_never_go_through_the_importer() {
    let (root, options) = fixture();
    assert!(matches!(
        source_kind(&options.source).expect("manifest dir"),
        SourceKind::Manifest
    ));
    assert!(matches!(
        source_kind(&options.source.join("mesh.gltf")).expect("gltf file"),
        SourceKind::Gltf(_)
    ));
    fs::remove_dir_all(root).expect("cleanup");
}
