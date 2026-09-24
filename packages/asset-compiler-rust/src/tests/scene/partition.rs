//! The world partition of the node table (#404): a scene whose placed nodes outgrow one stream
//! unit keeps them out of `scene-tables.json`, in cells of one size class each, every cell under
//! the unit's budget and boxed around what it holds — and the core the runtime reads before its
//! first frame does not grow with the world.
//!
//! Provenance: synthetic worlds built here on the fixture triangle (`tests/base.rs`), one node per
//! placement laid on a grid, as the open world lays its instances (flat scene roots, one mesh and a
//! translation each).
use super::*;

/// A full-scope compilation of the fixture with `nodes` as the scene: its tables and its folder.
fn compiled(nodes: Vec<Value>, lamps: bool) -> (PathBuf, Value, PathBuf) {
    let (root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["accessors"][0]["min"] = json!([0.0, 0.0, 0.0]);
    gltf["accessors"][0]["max"] = json!([1.0, 1.0, 0.0]);
    let count = nodes.len();
    gltf["nodes"] = json!(nodes);
    if lamps {
        gltf["extensionsUsed"] = json!(["KHR_lights_punctual"]);
        gltf["extensions"] = json!({"KHR_lights_punctual":{"lights":[{"type":"point"}]}});
        gltf["nodes"]
            .as_array_mut()
            .expect("nodes")
            .push(json!({"name":"lamp","extensions":{"KHR_lights_punctual":{"light":0}}}));
    }
    let roots: Vec<usize> = (0..count + usize::from(lamps)).collect();
    gltf["scenes"] = json!([{"nodes": roots}]);
    write_gltf(&options, &gltf, None);
    options.scope = "full".into();
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    let tables = read_json(&directory.join("scene-tables.json"));
    (root, tables, directory)
}

/// `side`² placements of the triangle, `spacing` apart, each at its own depth so no two share a
/// plane, all scaled by `scale`.
fn grid(side: usize, spacing: f64, scale: f64) -> Vec<Value> {
    (0..side * side)
        .map(|i| {
            let (x, z) = ((i % side) as f64, (i / side) as f64);
            json!({"name": format!("rock {i}"), "mesh": 0, "scale": [scale, scale, scale],
                "translation": [x * spacing, 0.0, z * spacing + i as f64 * 1e-3]})
        })
        .collect()
}

fn cells(tables: &Value) -> &Vec<Value> {
    tables["partition"]["cells"].as_array().expect("cells")
}

#[test]
fn a_scene_whose_placements_fit_one_unit_keeps_its_node_table_whole() {
    let (_root, tables, _dir) = compiled(grid(4, 4.0, 1.0), false);
    assert_eq!(tables["version"], json!(3));
    assert_eq!(
        tables["partition"],
        Value::Null,
        "nothing to read by distance"
    );
    assert_eq!(tables["nodes"].as_array().expect("nodes").len(), 16);
}

#[test]
fn placed_nodes_leave_the_core_for_cells_boxed_around_them() {
    let (_root, tables, directory) = compiled(grid(48, 4.0, 1.0), true);
    // The lamp stays: a node that hangs a light is read with the core.
    assert_eq!(
        tables["nodes"],
        json!([tables["nodes"][0]]),
        "{}",
        tables["nodes"]
    );
    assert_eq!(tables["nodes"][0]["name"], json!("lamp"));
    assert_eq!(tables["scene"]["nodes"], json!([0]), "roots renumbered");
    assert_eq!(tables["partition"]["meshes"], json!([0]));
    let mut seen = 0;
    for cell in cells(&tables) {
        let bytes = fs::read(directory.join(cell["url"].as_str().expect("url"))).expect("cell");
        assert_eq!(cell["bytes"], json!(bytes.len()));
        assert_eq!(cell["sha256"], json!(hash(&bytes)));
        assert!(
            bytes.len() <= crate::STREAM_BUNDLE_BYTES + 64,
            "a cell fits one unit"
        );
        let body: Value = serde_json::from_slice(&bytes).expect("json");
        let bounds: Vec<f64> = serde_json::from_value(cell["bounds"].clone()).expect("bounds");
        for node in body["nodes"].as_array().expect("nodes") {
            assert_eq!(node["parent"], Value::Null, "a scene root");
            assert_eq!(node["mesh"], json!(0));
            let t: Vec<f64> = serde_json::from_value(node["translation"].clone()).expect("t");
            for axis in 0..3 {
                assert!(
                    t[axis] >= bounds[axis] && t[axis] <= bounds[axis + 3],
                    "{t:?} in {bounds:?}"
                );
            }
            seen += 1;
        }
        assert_eq!(
            cell["meshes"],
            json!([[0, body["nodes"].as_array().expect("nodes").len()]]),
            "how many nodes of each mesh it places"
        );
        assert_eq!(
            cell["size"].as_f64().expect("size"),
            2f64.sqrt(),
            "the triangle's diagonal"
        );
    }
    assert_eq!(seen, 48 * 48, "every placement in exactly one cell");
}

#[test]
fn a_cell_holds_objects_of_one_size_class() {
    let mut nodes = grid(40, 4.0, 1.0);
    nodes.extend(grid(40, 400.0, 100.0));
    let (_root, tables, directory) = compiled(nodes, false);
    for cell in cells(&tables) {
        let body = read_json(&directory.join(cell["url"].as_str().expect("url")));
        let scales: BTreeSet<String> = body["nodes"]
            .as_array()
            .expect("nodes")
            .iter()
            .map(|n| n["scale"][0].to_string())
            .collect();
        assert_eq!(scales.len(), 1, "one class per cell: {scales:?}");
    }
}

#[test]
fn the_core_read_before_the_first_frame_does_not_grow_with_the_world() {
    // The same density over sixteen times the area: the core keeps the same nodes, every cell the
    // same budget; only the cell index grows, by one short entry per cell.
    let core = |side: usize| {
        let (_root, mut tables, _dir) = compiled(grid(side, 4.0, 1.0), true);
        let count = cells(&tables).len();
        tables["partition"]["cells"] = json!([]);
        tables["partition"]["bounds"] = json!([]);
        (serde_json::to_vec(&tables).expect("json").len(), count)
    };
    let (small, small_cells) = core(48);
    let (large, large_cells) = core(48 * 4);
    assert_eq!(small, large, "the core without its cell index");
    assert!(
        large_cells > small_cells,
        "{small_cells} → {large_cells} cells"
    );
}

#[test]
fn a_placement_under_an_animated_node_stays_in_the_core() {
    // Its cell's box is written from the declared poses: a parent an animation moves would carry
    // it out of that box, so it is read with the core.
    let side = 48;
    let mut nodes = grid(side, 4.0, 1.0);
    nodes.push(json!({"name": "carrier", "children": (0..side * side).collect::<Vec<_>>()}));
    let (root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["accessors"][0]["min"] = json!([0.0, 0.0, 0.0]);
    gltf["accessors"][0]["max"] = json!([1.0, 1.0, 0.0]);
    gltf["nodes"] = json!(nodes);
    gltf["scenes"] = json!([{"nodes": [side * side]}]);
    gltf["animations"] = json!([{"channels": [{"sampler": 0, "target": {"node": side * side, "path": "translation"}}],
        "samplers": [{"input": 0, "output": 0}]}]);
    write_gltf(&options, &gltf, None);
    options.scope = "full".into();
    let result = compile(&options, |_| {}).expect("compile");
    let tables = read_json(
        &options
            .key_directory(result["key"].as_str().expect("key"))
            .join("scene-tables.json"),
    );
    drop(root);
    assert_eq!(tables["partition"], Value::Null, "nothing leaves the core");
    assert_eq!(
        tables["nodes"].as_array().expect("nodes").len(),
        side * side + 1
    );
}
