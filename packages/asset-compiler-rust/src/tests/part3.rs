use super::*;

#[test]
fn compile_dag_bundles_clusters_for_streaming_and_names_their_group() {
    let (root, options) = grid_fixture_displaced(100, 100, 3.0);
    let result = compile(&options, |_| {}).expect("compile");
    let primitive = &result["primitives"][0];
    let directory = options
        .cache
        .join("native/full")
        .join(result["key"].as_str().expect("key"));
    let pages = primitive["pages"].as_array().expect("pages");
    let streams = &primitive["streams"];
    assert_eq!(streams["version"], STRUCTURE_VERSION);
    let bundles = streams["pages"].as_array().expect("bundles");
    assert!(
        bundles.len() > 1,
        "a 20 000 triangle grid must need several bundles"
    );
    assert!(
        bundles.len() * 30 < pages.len(),
        "a bundle must carry dozens of clusters"
    );
    let pinned = streams["pinned"].as_u64().expect("pinned") as usize;
    assert!(pinned >= 1 && pinned <= bundles.len());
    // Every page sits in exactly one bundle, at the recorded offset, and bundles stay homogeneous.
    let mut members: Vec<Vec<usize>> = vec![Vec::new(); bundles.len()];
    for (id, page) in pages.iter().enumerate() {
        let bundle = page["stream"].as_u64().expect("stream") as usize;
        assert!(bundle < bundles.len());
        members[bundle].push(id);
    }
    assert_eq!(members.iter().map(Vec::len).sum::<usize>(), pages.len());
    for (index, bundle) in bundles.iter().enumerate() {
        assert!(!members[index].is_empty());
        let level = pages[members[index][0]]["level"].clone();
        let is_root = pages[members[index][0]]["parentError"].is_null();
        assert_eq!(
            index < pinned,
            is_root,
            "pinned bundles are exactly the ones holding the coarsest cover"
        );
        let payload =
            fs::read(directory.join(bundle["url"].as_str().expect("bundle URL"))).expect("bundle");
        assert_eq!(
            payload.len() as u64,
            bundle["bytes"].as_u64().expect("bytes")
        );
        assert_eq!(
            bundle["count"].as_u64().expect("count") as usize,
            members[index].len()
        );
        let mut covered = 0usize;
        for &id in &members[index] {
            assert_eq!(pages[id]["level"], level, "a bundle holds one level");
            assert_eq!(pages[id]["parentError"].is_null(), is_root);
            let offset = pages[id]["streamOffset"].as_u64().expect("offset") as usize;
            let length = pages[id]["count"].as_u64().expect("count") as usize * 4;
            let single = fs::read(directory.join(pages[id]["url"].as_str().expect("page URL")))
                .expect("page");
            assert_eq!(single.len(), length);
            assert_eq!(
                &payload[offset..offset + length],
                &single[..],
                "a cluster must be readable at its offset in the bundle"
            );
            covered += length;
        }
        assert_eq!(covered, payload.len(), "a bundle is exactly its clusters");
    }
    // The structure links every cluster to the group that replaces it and lists the coarse cover.
    let structure = &primitive["structure"];
    assert_eq!(structure["version"], STRUCTURE_VERSION);
    let roots = structure["roots"].as_array().expect("roots");
    assert!(!roots.is_empty());
    for entry in roots {
        assert!(pages[entry.as_u64().expect("root id") as usize]["parentError"].is_null());
    }
    let groups = structure["groups"].as_array().expect("groups");
    assert!(!groups.is_empty());
    let mut owned = vec![0usize; pages.len()];
    for (index, group) in groups.iter().enumerate() {
        let children = group["children"].as_array().expect("children");
        let outputs = group["outputs"].as_array().expect("outputs");
        assert!(!children.is_empty() && !outputs.is_empty());
        for child in children {
            let id = child.as_u64().expect("child id") as usize;
            owned[id] += 1;
            assert_eq!(pages[id]["group"].as_u64().expect("group") as usize, index);
            assert_eq!(pages[id]["parentError"], group["error"]);
            assert_eq!(pages[id]["parentSphere"], group["sphere"]);
        }
        for output in outputs {
            let id = output.as_u64().expect("output id") as usize;
            assert_eq!(pages[id]["lodError"], group["error"]);
            assert_eq!(pages[id]["sphere"], group["sphere"]);
            assert_eq!(
                pages[id]["source"].as_u64().expect("source") as usize,
                index
            );
        }
    }
    for (id, page) in pages.iter().enumerate() {
        assert_eq!(owned[id], if page["parentError"].is_null() { 0 } else { 1 });
        assert_eq!(
            page["source"].is_null(),
            page["level"] == 0,
            "only level 0 has no producing group"
        );
    }
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_dag_covers_transparent_primitives_and_records_their_source_rank() {
    let (root, options) = grid_fixture_displaced(80, 80, 3.0);
    let gltf_path = options.source.join("grid.gltf");
    let mut gltf: Value =
        serde_json::from_slice(&fs::read(&gltf_path).expect("read")).expect("json");
    let material = json!({"alphaMode":"BLEND","doubleSided":true,"pbrMetallicRoughness":{"baseColorFactor":[0.2,0.8,0.3,0.45]}});
    gltf["materials"] = json!([material.clone()]);
    gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    let gltf_bytes = serde_json::to_vec(&gltf).expect("encode");
    fs::write(&gltf_path, &gltf_bytes).expect("write");
    fs::remove_file(options.source.join("manifest.json")).expect("direct source");
    let result = compile(&options, |_| {}).expect("compile");
    let primitive = &result["primitives"][0];
    assert_eq!(
        primitive["pass"], "clustered-blend",
        "the material stays blended, it is never turned into a mask"
    );
    assert_eq!(
        primitive["clusterStrategy"], DAG_CLUSTER_STRATEGY,
        "a transparent primitive now gets its own DAG"
    );
    let directory = options
        .cache
        .join("native/full")
        .join(result["key"].as_str().expect("key"));
    let source: Value =
        serde_json::from_slice(&fs::read(directory.join("source.gltf")).expect("source"))
            .expect("json");
    assert_eq!(source["materials"][0], material);
    let pages = primitive["pages"].as_array().expect("pages");
    let exact: Vec<&Value> = pages
        .iter()
        .filter(|page| page["role"] == "exact")
        .collect();
    assert_eq!(
        exact
            .iter()
            .map(|page| page["count"].as_u64().expect("count"))
            .sum::<u64>(),
        80 * 80 * 2 * 3
    );
    // Source ranks must span the index buffer so the runtime can restore a blend order.
    let mut starts: Vec<u64> = exact
        .iter()
        .map(|page| page["start"].as_u64().expect("start"))
        .collect();
    starts.sort_unstable();
    assert_eq!(starts[0], 0);
    assert!(starts.last().copied().expect("start") > 0);
    assert!(starts.windows(2).all(|pair| pair[0] <= pair[1]));
    assert!(
        starts
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            > starts.len() / 2,
        "source ranks must discriminate pages"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
