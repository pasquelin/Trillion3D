use super::*;

#[test]
fn compile_lays_every_page_in_a_bundle_of_a_geometry_file_and_names_its_group() {
    let (root, options) = grid_fixture_displaced(100, 100, 3.0);
    let result = compile(&options, |_| {}).expect("compile");
    let primitive = &result["primitives"][0];
    let pages = primitive["pages"].as_array().expect("pages");
    let files = result["geometryFiles"].as_array().expect("geometry files");
    assert_eq!(files.len(), 1, "a 20 000 triangle grid fits one container");
    let file_bytes = files[0]["bytes"].as_u64().expect("bytes") as usize;
    let streams = &primitive["streams"];
    let bundles = streams["pages"].as_array().expect("bundles");
    assert!(
        bundles.len() > 1,
        "a 20 000 triangle grid needs several bundles"
    );
    assert!(
        bundles.len() * 8 < pages.len(),
        "a bundle carries many pages"
    );
    let pinned = streams["pinned"].as_u64().expect("pinned") as usize;
    let at = |value: &Value, key: &str| value[key].as_u64().expect(key) as usize;
    // The bundles tile the container, the pinned first; each holds its pages end to end, proven
    // by its digest, each page decoding.
    let mut tiles: Vec<(usize, usize)> = bundles
        .iter()
        .map(|b| (at(b, "offset"), at(b, "bytes")))
        .collect();
    tiles.sort();
    let mut end = 0;
    for &(offset, bytes) in &tiles {
        assert_eq!(offset, end, "the bundles lie end to end");
        end += bytes;
    }
    assert_eq!(end, file_bytes, "a container is exactly its bundles");
    let pinned_end = bundles[..pinned]
        .iter()
        .map(|b| at(b, "offset") + at(b, "bytes"))
        .max();
    let rest_start = bundles[pinned..].iter().map(|b| at(b, "offset")).min();
    assert!(pinned_end <= rest_start, "the pinned bundles lie first");
    let container =
        fs::read(object_path(&options, files[0]["sha256"].as_str().unwrap())).expect("container");
    let mut members = vec![Vec::new(); bundles.len()];
    let mut read = PrimitivePages::new(&options.cache, &result, primitive);
    for (id, page) in pages.iter().enumerate() {
        members[at(page, "stream")].push(id);
        read.decoded(page);
    }
    for (index, bundle) in bundles.iter().enumerate() {
        let bytes = &container[at(bundle, "offset")..at(bundle, "offset") + at(bundle, "bytes")];
        assert_eq!(
            hash(bytes),
            bundle["sha256"].as_str().unwrap(),
            "bundle {index}"
        );
        assert_eq!(at(bundle, "count"), members[index].len());
        let covered: usize = members[index]
            .iter()
            .map(|&id| at(&pages[id]["geometry"], "bytes"))
            .sum();
        assert_eq!(covered, bytes.len(), "a bundle is exactly its pages");
        assert_eq!(
            index < pinned,
            (members[index].iter()).any(|&id| pages[id]["parentError"].is_null()),
            "the pinned bundle is the root page: it alone holds roots"
        );
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
    let mut gltf: Value = read_json(&gltf_path);
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
    let source: Value = read_json(&directory.join("source.gltf"));
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
