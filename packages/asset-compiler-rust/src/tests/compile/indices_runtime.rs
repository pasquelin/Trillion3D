use super::*;

#[test]
fn compile_indexes_unindexed_triangles() {
    let (root, options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["meshes"][0]["primitives"][0]
        .as_object_mut()
        .expect("primitive")
        .remove("indices");
    write_gltf(&options, &gltf, None);
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["selectedTriangles"], 1);
    assert_eq!(result["primitives"][0]["pages"][0]["count"], 3);
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_reads_named_runtime_file() {
    let (root, options) = fixture_named("cube.gltf", "cube.bin");
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["selectedTriangles"], 1);
    assert!(options.cache.join("native/slice/manifest.json").exists());
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_rejects_unsafe_runtime_file() {
    let (root, options) = fixture_named("mesh.gltf", "mesh.bin");
    let manifest_path = options.source.join("manifest.json");
    let mut manifest: Value =
        serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");
    manifest["runtime"]["file"] = json!("../mesh.gltf");
    fs::write(
        &manifest_path,
        serde_json::to_vec(&manifest).expect("encode"),
    )
    .expect("write");
    assert_eq!(
        compile(&options, |_| {}).expect_err("unsafe").code,
        "INVALID_GLTF"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_dag_emits_a_flat_per_cluster_cut() {
    let (root, options) = grid_fixture_displaced(100, 100, 3.0);
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["errorModel"], DAG_ERROR_MODEL);
    assert_eq!(result["clusterStrategy"], DAG_CLUSTER_STRATEGY);
    let primitive = &result["primitives"][0];
    assert_eq!(primitive["clusterStrategy"], DAG_CLUSTER_STRATEGY);
    assert!(
        primitive["hierarchy"].is_null(),
        "the DAG cut needs no hierarchy tree"
    );
    let depth = primitive["dag"]["depth"].as_u64().expect("depth");
    assert!(
        depth >= 2,
        "a 20 000 triangle grid must coarsen more than once, got depth {depth}"
    );
    let pages = primitive["pages"].as_array().expect("pages");
    let mut exact_indices = 0usize;
    let mut roots = 0usize;
    let mut coarse = 0usize;
    for page in pages {
        let level = page["level"].as_u64().expect("level");
        let lod = page["lodError"].as_f64().expect("lodError");
        let sphere = page["sphere"].as_array().expect("sphere");
        assert_eq!(sphere.len(), 4);
        assert!(sphere[3].as_f64().expect("radius") >= 0.0);
        assert!(lod >= 0.0);
        if level == 0 {
            assert_eq!(page["role"], "exact");
            assert_eq!(lod, 0.0);
            exact_indices += page["count"].as_u64().expect("count") as usize;
        } else {
            assert_eq!(page["role"], "coarse");
            assert!(lod > 0.0);
            coarse += 1;
        }
        assert!(
            page["count"].as_u64().expect("count")
                <= (crate::dag::DAG_CLUSTER_TRIANGLES * 3) as u64
        );
        match page["parentError"].as_f64() {
            Some(parent) => {
                assert!(parent >= lod, "parent error {parent} below LOD error {lod}");
                let parent_sphere = page["parentSphere"].as_array().expect("parentSphere");
                let centre = |v: &Vec<Value>, i: usize| v[i].as_f64().expect("coordinate");
                let distance = ((centre(sphere, 0) - centre(parent_sphere, 0)).powi(2)
                    + (centre(sphere, 1) - centre(parent_sphere, 1)).powi(2)
                    + (centre(sphere, 2) - centre(parent_sphere, 2)).powi(2))
                .sqrt();
                assert!(
                    distance + centre(sphere, 3) <= centre(parent_sphere, 3) + 1e-6,
                    "parent bounds must enclose the cluster bounds"
                );
            }
            None => {
                assert!(page["parentSphere"].is_null());
                roots += 1;
            }
        }
    }
    assert_eq!(
        exact_indices,
        20000 * 3,
        "level 0 pages must cover the source index buffer once"
    );
    assert!(coarse > 0);
    assert!(roots > 0);
    // The culling hierarchy must own every page exactly once and bound it.
    let culling = &primitive["culling"];
    assert_eq!(culling["stride"], CULLING_STRIDE);
    let count = culling["count"].as_u64().expect("count") as usize;
    let nodes = culling["nodes"].as_array().expect("nodes");
    assert_eq!(nodes.len(), count * CULLING_STRIDE);
    assert!(count > 1, "a 20 000 triangle grid must need interior nodes");
    let number = |index: usize| nodes[index].as_f64().expect("culling number");
    let mut covered = vec![0usize; pages.len()];
    for node in 0..count {
        let base = node * CULLING_STRIDE;
        let children = number(base + 12) as usize;
        let page_count = number(base + 14) as usize;
        if children > 0 {
            assert_eq!(page_count, 0);
            assert!(number(base + 11) as usize + children <= count);
            continue;
        }
        let first = number(base + 13) as usize;
        assert!(page_count > 0 && first + page_count <= pages.len());
        for id in first..first + page_count {
            covered[id] += 1;
            for axis in [0, 1, 2] {
                assert!(
                    pages[id]["min"][axis].as_f64().expect("min") >= number(base + axis) - 1e-6,
                    "page outside its node box"
                );
                assert!(
                    pages[id]["max"][axis].as_f64().expect("max") <= number(base + 3 + axis) + 1e-6,
                    "page outside its node box"
                );
            }
            let parent = pages[id]["parentError"].as_f64();
            let bound = number(base + 10);
            assert!(
                bound < 0.0 || parent.map(|value| value <= bound + 1e-9).unwrap_or(false),
                "node error bound below a page it owns"
            );
        }
    }
    assert!(
        covered.iter().all(|&n| n == 1),
        "every page belongs to exactly one culling leaf"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
