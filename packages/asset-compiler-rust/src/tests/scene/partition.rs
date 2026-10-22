//! The world partition of the node table (#404): a scene whose placed nodes outgrow one stream
//! unit keeps them out of `scene-tables.json`, in cells under the unit's budget, each boxed around
//! what it holds in the frame of the core parent it hangs it under — and the core the runtime reads
//! before its first frame does not grow with the world.
//!
//! Provenance: synthetic worlds built here on the fixture triangle (`tests/base.rs`), one node per
//! placement laid on a grid, as the open world lays its instances (flat scene roots, one mesh and a
//! translation each).
use super::*;

/// A full-scope compilation of the fixture with `nodes` as the scene, `roots` its roots and `edit`
/// any other change to the document: its options, its tables and its folder.
fn compiled_with(
    nodes: Vec<Value>,
    roots: Vec<usize>,
    edit: impl FnOnce(&mut Value),
) -> (Options, Value, PathBuf) {
    compiled_with_options(nodes, roots, edit, |_| {})
}

/// The same under the options `set` changes.
fn compiled_with_options(
    nodes: Vec<Value>,
    roots: Vec<usize>,
    edit: impl FnOnce(&mut Value),
    set: impl FnOnce(&mut Options),
) -> (Options, Value, PathBuf) {
    let (_root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["accessors"][0]["min"] = json!([0.0, 0.0, 0.0]);
    gltf["accessors"][0]["max"] = json!([1.0, 1.0, 0.0]);
    gltf["nodes"] = json!(nodes);
    gltf["scenes"] = json!([{"nodes": roots}]);
    edit(&mut gltf);
    write_gltf(&options, &gltf, None);
    set(&mut options);
    compiled_full(options)
}

/// A full-scope compilation with `options`: its options, its tables and its folder.
pub(super) fn compiled_full(mut options: Options) -> (Options, Value, PathBuf) {
    options.scope = "full".into();
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    let tables = read_json(&directory.join("scene-tables.json"));
    (options, tables, directory)
}

/// The same with `nodes` as the scene's roots, and a lamp beside them when `lamps`.
pub(super) fn compiled(mut nodes: Vec<Value>, lamps: bool) -> (Options, Value, PathBuf) {
    if lamps {
        nodes.push(json!({"name":"lamp","extensions":{"KHR_lights_punctual":{"light":0}}}));
    }
    let roots = (0..nodes.len()).collect();
    compiled_with(nodes, roots, |gltf| {
        if lamps {
            gltf["extensionsUsed"] = json!(["KHR_lights_punctual"]);
            gltf["extensions"] = json!({"KHR_lights_punctual":{"lights":[{"type":"point"}]}});
        }
    })
}

/// `side`² placements of the triangle, `spacing` apart, each at its own depth so no two share a
/// plane, all scaled by `scale`.
pub(super) fn grid(side: usize, spacing: f64, scale: f64) -> Vec<Value> {
    (0..side * side)
        .map(|i| {
            let (x, z) = ((i % side) as f64, (i / side) as f64);
            json!({"name": format!("rock {i}"), "mesh": 0, "scale": [scale, scale, scale],
                "translation": [x * spacing, 0.0, z * spacing + i as f64 * 1e-3]})
        })
        .collect()
}

/// The cell records of the tables in `directory`, read through their pages.
pub(super) fn cells(directory: &Path) -> Vec<Value> {
    let records = crate::compiler::tables::cell_records(directory).expect("cell records");
    records.into_values().collect()
}

/// Every node the cells of the tables in `directory` place, cell after cell: its core parent, its
/// mesh and its pose, as a cell writes it.
pub(in crate::tests) fn cell_nodes(directory: &Path) -> Vec<Value> {
    let cell = |record: Value| read_json(&directory.join(record["url"].as_str().expect("url")));
    (cells(directory).into_iter().map(cell))
        .flat_map(|body| body["nodes"].as_array().expect("nodes").clone())
        .collect()
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
    let mut seen = 0;
    for cell in cells(&directory) {
        let bytes = fs::read(directory.join(cell["url"].as_str().expect("url"))).expect("cell");
        assert_eq!(cell["bytes"], json!(bytes.len()));
        assert_eq!(cell["sha256"], json!(hash(&bytes)));
        assert!(
            bytes.len() <= crate::STREAM_BUNDLE_BYTES + 64,
            "a cell fits one unit"
        );
        let body: Value = serde_json::from_slice(&bytes).expect("json");
        // Scene roots: one box, in the scene's frame.
        assert_eq!(cell["parents"].as_array().expect("parents").len(), 1);
        assert_eq!(cell["parents"][0][0], Value::Null);
        let bounds: Vec<f64> = serde_json::from_value(cell["parents"][0][1].clone()).expect("box");
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
    }
    assert_eq!(seen, 48 * 48, "every placement in exactly one cell");
}

#[test]
fn a_cell_boxes_its_nodes_in_the_frame_of_their_core_parent() {
    // Placements under a still group node: a page may move that node, and the runtime moves the
    // box with it, so the box is written in its frame, not at the pose the file gives the group.
    let side = 48;
    let mut nodes = grid(side, 4.0, 1.0);
    let children: Vec<usize> = (0..side * side).collect();
    nodes
        .push(json!({"name": "district", "translation": [1000.0, 0.0, 0.0], "children": children}));
    let (_root, tables, directory) = compiled_with(nodes, vec![side * side], |_| {});
    assert_eq!(tables["nodes"][0]["name"], json!("district"));
    let mut low = f64::INFINITY;
    for cell in cells(&directory) {
        assert_eq!(cell["parents"].as_array().expect("parents").len(), 1);
        assert_eq!(cell["parents"][0][0], json!(0), "the district's core rank");
        low = low.min(cell["parents"][0][1][0].as_f64().expect("min x"));
    }
    assert_eq!(low, 0.0, "in the district's frame, not 1000 m away");
    // A world this small is one region page: its slot's box, minimum x, after digest and size —
    // the low edge of the main grid cell the district's first placements lie in.
    let slot = tables["partition"]["pages"][0].as_str().expect("slot");
    let union = f64::from_bits(u64::from_str_radix(&slot[72..88], 16).expect("hex"));
    let cell = crate::DEFAULT_PARTITION_CELL_SIZE;
    assert!(
        union <= 1000.0 && union > 1000.0 - cell,
        "the union box is at the declared poses: {union}"
    );
}

#[test]
fn a_hidden_placement_and_one_under_a_hidden_node_stay_in_the_core_that_says_so() {
    // A cell's row carries no visibility: a node a hidden node hides is read with the core (#519).
    let side = 48;
    let mut nodes = grid(side, 4.0, 1.0);
    nodes[0]["extensions"] = json!({"KHR_node_visibility": {"visible": false}});
    let group = json!({"children": [1], "extensions": {"KHR_node_visibility": {"visible": false}}});
    nodes.push(group);
    let roots = std::iter::once(0).chain(2..=side * side).collect();
    let (_root, tables, _dir) = compiled_with(nodes, roots, |_| {});
    let core: Vec<_> = (tables["nodes"].as_array().expect("nodes").iter())
        .map(|node| node["visible"].clone())
        .collect();
    assert_eq!(
        core,
        [json!(false), json!(true), json!(false)],
        "{}",
        tables["nodes"]
    );
}

/// A full-scope compilation of `nodes`, all scene roots, under the job `job`, whose
/// `partitionGrids` and `objectSettings` it reads as the job's: its options, its tables and its
/// folder.
fn compiled_job(nodes: Vec<Value>, job: Value) -> (Options, Value, PathBuf) {
    let roots = (0..nodes.len()).collect();
    let job = job.as_object().expect("a job").clone();
    compiled_with_options(
        nodes,
        roots,
        |_| {},
        |options| {
            options.partition_grid = crate::PartitionGrid::read(&job);
            options.object_settings = crate::ObjectSettings::read(job.get("objectSettings"));
        },
    )
}

#[test]
fn objects_streaming_on_another_grid_have_cells_of_its_own() {
    // Sixteen placements on a row, 100 m apart, the odd ones named "far": on the default grid, 128
    // m cells, the even ones take a cell each; the far ones stream on a grid of 1024 m cells, which
    // cuts height too; a third grid has no object.
    let names = ["near", "far"];
    let nodes: Vec<Value> = (0..16)
        .map(|i| json!({"name": names[i % 2], "mesh": 0, "translation": [i as f64 * 100.0, 0.0, 0.0]}))
        .collect();
    let job = json!({
        "partitionGrids": [
            {},
            {"name": "far", "cellSize": 1024.0, "loadingRange": 2048.0, "flat": false},
            {"name": "empty", "loadingRange": 100000.0},
        ],
        "objectSettings": {"objects": [{"match": "far", "runtimeGrid": "far"}]},
    });
    let (_options, tables, directory) = compiled_job(nodes.clone(), job);
    let root = &tables["partition"];
    assert_eq!(root["hlod"]["mains"], json!(3));
    assert_eq!(
        root["version"],
        json!(14),
        "several main grids, the next version"
    );
    assert_eq!(root["flat"], json!(true), "the first grid's");
    // The flags of each grid: cell files stream on those that own a cell, the far grid lies flat
    // unlike the first.
    let flags = |at: usize| {
        let word = root["hlod"]["grids"][at].as_str().expect("a grid");
        u32::from_str_radix(&word[48..], 16).expect("flags")
    };
    assert_eq!((flags(0), flags(1), flags(2)), (2, 2 | 4, 0));
    // Each grid's cells: how many files, how many nodes they place, how many coordinates.
    let records = cells(&directory);
    let on_grid = |main: u64| {
        let there = records
            .iter()
            .filter(|r| r["main"].as_u64().unwrap_or(0) == main);
        let counts = there
            .clone()
            .flat_map(|r| r["meshes"].as_array().expect("meshes"));
        let nodes = counts.map(|m| m[1].as_u64().expect("nodes")).sum::<u64>();
        let width = there
            .clone()
            .map(|r| r["grid"].as_array().expect("grid").len())
            .max();
        (there.count(), nodes, width)
    };
    assert_eq!(
        on_grid(0),
        (8, 8, Some(3)),
        "the near objects, a cell each, on the ground"
    );
    assert_eq!(
        on_grid(1),
        (2, 8, Some(4)),
        "the far ones, in the two cells their row crosses"
    );
    assert_eq!(on_grid(2), (0, 0, None), "no object, no cell");
    // A job naming no grids writes no rank of a main grid and no count, in the version before.
    let (_options, plain, directory) = compiled(nodes, false);
    assert!(plain["partition"]["hlod"].get("mains").is_none());
    assert_eq!(plain["partition"]["version"], json!(13));
    assert!(cells(&directory)
        .iter()
        .all(|record| record.get("main").is_none()));
}
