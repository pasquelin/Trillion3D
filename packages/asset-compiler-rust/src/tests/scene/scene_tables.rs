//! Correctness of `scene-tables.json`, the node table and the geometry layout of each published
//! document. Its material table is proven by `surface_tables.rs`.
//!
//! Provenance of every case: the glTF the compilation itself publishes as `source.gltf`, built
//! here from the repository's own triangle fixture (`tests/base.rs`) — no asset is read from
//! outside this crate. Each case names the glTF field it comes from, so what the table claims can
//! be traced back to the specification it is read from.
use super::*;
use crate::tests::cache::reuse::compile_with_events;

/// Cube corners on the fixture triangle's accessor, so a world box has something to grow from.
fn with_bounds(gltf: &mut Value) {
    gltf["accessors"][0]["min"] = json!([0.0, 0.0, 0.0]);
    gltf["accessors"][0]["max"] = json!([1.0, 1.0, 0.0]);
}
/// The tables a compilation published, as the runtime will read them.
pub(in crate::tests) fn tables_of(options: &Options) -> Value {
    let result = compile(options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    read_json(&directory.join("scene-tables.json"))
}
/// A full-scope compilation of the fixture, altered by the case before it is written back.
pub(in crate::tests) fn published(alter: impl FnOnce(&mut Value)) -> (PathBuf, Value) {
    let (root, directory) = published_folder(alter);
    (root, read_json(&directory.join("scene-tables.json")))
}
/// The same compilation, answering the folder it wrote: its other products are read beside.
pub(in crate::tests) fn published_folder(alter: impl FnOnce(&mut Value)) -> (PathBuf, PathBuf) {
    let (root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    with_bounds(&mut gltf);
    alter(&mut gltf);
    write_gltf(&options, &gltf, None);
    options.scope = "full".into();
    let result = compile(&options, |_| {}).expect("compile");
    (
        root,
        options.key_directory(result["key"].as_str().expect("key")),
    )
}

#[test]
fn the_node_table_carries_every_node_and_its_local_pose() {
    // A parent that moves its two children: the pose written is the one each node declares, which
    // the runtime composes itself — the same bits the document gives. The children, placed meshes,
    // lie in a cell under their core parent (`compiler/tables/partition.rs`).
    let (_root, directory) = published_folder(|gltf| {
        gltf["scenes"] = json!([{"name":"stage","nodes":[0]}]);
        gltf["nodes"] = json!([
            {"name":"root","translation":[10.0,0.0,0.0],"children":[1,2]},
            {"name":"left","mesh":0},
            {"name":"right","mesh":0,"matrix":[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,2.0,0.0,1.0]},
        ]);
    });
    let tables = read_json(&directory.join("scene-tables.json"));
    assert_eq!(tables["scene"], json!({"name":"stage","nodes":[0]}));
    let nodes = tables["nodes"].as_array().expect("nodes");
    assert_eq!(nodes.len(), 1, "the core keeps the parent: {tables}");
    assert_eq!(nodes[0]["translation"], json!([10.0, 0.0, 0.0]));
    assert_eq!(nodes[0]["mesh"], Value::Null);
    assert_eq!(
        nodes[0]["visible"],
        json!(true),
        "no KHR_node_visibility: visible"
    );
    let placed = super::partition::cell_nodes(&directory);
    assert_eq!(placed.len(), 2, "every child, in a cell");
    assert!(
        placed
            .iter()
            .all(|node| node["parent"] == json!(0) && node["mesh"] == json!(0)),
        "two nodes naming one mesh under the parent: instancing"
    );
    let matrix = |node: &Value| node["matrix"].clone();
    assert!(
        placed.iter().any(|node| matrix(node)[13] == json!(2.0)),
        "a matrix pose is kept as a matrix"
    );
    assert!(
        placed.iter().any(|node| matrix(node) == Value::Null),
        "no pose declared, none invented"
    );
}

#[test]
fn the_document_lays_out_every_primitive_in_its_binary() {
    let (_root, tables) = published(|_| {});
    let source = &tables["document"];
    assert_eq!(source["buffer"], json!("source.bin"));
    let primitive = &source["meshes"][0]["primitives"][0];
    let position = &source["accessors"][primitive["attributes"]["POSITION"]
        .as_u64()
        .expect("position") as usize];
    assert_eq!(position["componentType"], json!(5126));
    assert_eq!(position["type"], json!("VEC3"));
    assert_eq!(position["count"], json!(3));
    assert_eq!(
        (position["min"].clone(), position["max"].clone()),
        (json!([0.0, 0.0, 0.0]), json!([1.0, 1.0, 0.0])),
        "the box the positions declare, which the host bounds its geometry by"
    );
    let view = &source["views"][position["view"].as_u64().expect("view") as usize];
    assert_eq!(view["length"], json!(36), "three positions of twelve bytes");
    assert!(
        primitive["indices"].is_u64(),
        "the index list is laid out too"
    );
    // A primitive that declares no material wears the glTF default one, which is an entry like
    // any other: the document names a rank, never an absence.
    assert_eq!(primitive["material"], json!(0));
    assert_eq!(
        tables["materials"][0]["metalness"],
        json!(1.0),
        "the glTF default"
    );
}

#[test]
fn the_tables_describe_the_published_scene_and_not_the_input() {
    // The slice keeps one node of the two and renumbers what it keeps: the tables follow the
    // document the runtime draws, so a node left out of the slice is absent from them.
    let (_root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    with_bounds(&mut gltf);
    gltf["meshes"] = json!([{"primitives":[]}, gltf["meshes"][0]]);
    gltf["nodes"] = json!([{"mesh":1},{"mesh":1}]);
    write_gltf(&options, &gltf, None);
    options.triangle_budget = 1;
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    let tables = read_json(&directory.join("scene-tables.json"));
    // The node left out keeps its place in the graph and draws nothing; the one kept is placed, in
    // a cell.
    let placed = super::partition::cell_nodes(&directory);
    assert_eq!(
        placed
            .iter()
            .map(|node| node["mesh"].clone())
            .collect::<Vec<_>>(),
        [json!(0)],
        "the rank the published scene uses"
    );
    assert_eq!(tables["nodes"][0]["mesh"], Value::Null, "{tables}");
    assert_eq!(
        tables["document"]["meshes"].as_array().map(Vec::len),
        Some(1),
        "one mesh fits the slice"
    );
}

#[test]
fn the_format_number_is_raised_and_an_earlier_cache_is_refused_by_it() {
    let (_root, options) = fixture();
    let (first, _) = compile_with_events(&options);
    assert_eq!(first["formatVersion"], json!(FORMAT_VERSION));
    assert_eq!(
        FORMAT_VERSION, 11,
        "the batch that drops the second, self-contained scene raises it"
    );
    let path = options
        .key_directory(first["key"].as_str().expect("key"))
        .join("clusters.json");
    let mut manifest = read_json(&path);
    manifest["formatVersion"] = json!(3);
    fs::write(&path, serde_json::to_vec(&manifest).expect("encode")).expect("tamper");
    let (_second, events) = compile_with_events(&options);
    assert_eq!(
        events[0]["reason"],
        "manifest format 3 is not one this compiler writes"
    );
}

#[test]
fn an_object_naming_a_draw_distance_carries_it_in_its_core_node_or_its_cell_row() {
    // Provenance: the job's `objectSettings.drawDistance`, read like every object setting. "left"
    // streams in a cell row; "right" is always loaded, so the core keeps it; "behind" names a
    // nearest distance alone and "zero" a farthest of 0 — no farthest, no distance, as `false`
    // says —, "plain" names none.
    let (_root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    with_bounds(&mut gltf);
    gltf["scenes"] = json!([{"nodes": [0]}]);
    gltf["nodes"] = json!([
        {"name": "root", "children": [1, 2, 3, 4, 5]},
        {"name": "left", "mesh": 0},
        {"name": "right", "mesh": 0},
        {"name": "behind", "mesh": 0},
        {"name": "plain", "mesh": 0},
        {"name": "zero", "mesh": 0},
    ]);
    write_gltf(&options, &gltf, None);
    options.object_settings = crate::ObjectSettings::read(Some(&json!({"objects": [
        {"match": "left", "drawDistance": {"min": 5.0, "max": 120.0}},
        {"match": "right", "spatiallyLoaded": false, "drawDistance": {"max": 30.0}},
        {"match": "behind", "drawDistance": {"min": 5.0}},
        {"match": "zero", "drawDistance": {"min": 5.0, "max": 0.0}},
    ]})));
    let (_options, tables, directory) = partition::compiled_full(options);
    let core = tables["nodes"].as_array().expect("nodes");
    let named = core.iter().find(|node| node["name"] == json!("right"));
    assert_eq!(
        named.map(|node| node["drawDistance"].clone()),
        Some(json!({"min": 0.0, "max": 30.0})),
        "{tables}"
    );
    assert_eq!(
        core.iter()
            .filter(|node| node.get("drawDistance").is_some())
            .count(),
        1,
        "no other core node names one: {tables}"
    );
    let rows = partition::cell_nodes(&directory);
    let drawn: Vec<_> = (rows.iter())
        .filter_map(|row| row.get("drawDistance"))
        .collect();
    assert_eq!(drawn, [&json!({"min": 5.0, "max": 120.0})], "{rows:?}");
}

/// `count` unit right triangles side by side, each covering `covered` in the texture coordinate of
/// set 0 (twice its area): the positions, the indices and the sets of a primitive that has one.
fn stretched(count: usize, covered: f32) -> (Vec<f32>, Vec<u32>, [Option<Vec<f32>>; 4]) {
    let (mut positions, mut uv) = (Vec::new(), Vec::new());
    for i in 0..count {
        let x = 2.0 * i as f32;
        positions.extend([x, 0.0, 0.0, x + 1.0, 0.0, 0.0, x, 1.0, 0.0]);
        uv.extend([0.0, 0.0, covered.sqrt(), 0.0, 0.0, covered.sqrt()]);
    }
    let indices = (0..3 * count as u32).collect();
    (positions, indices, [Some(uv), None, None, None])
}

#[test]
fn a_displaced_materials_uv_density_is_the_trimmed_weighted_mean_over_its_triangles() {
    use crate::compiler::tables::uv_density::Density;
    // Each triangle is a unit right triangle: twice its area is 1. It covers 1/4 of the coordinate,
    // so a unit of the coordinate spans 2 units of the object.
    let (mut positions, mut indices, mut sets) = stretched(9, 0.25);
    // A tenth triangle that covers 1/100 says 10; the tenth of the triangles that say the most, and
    // that many of those that say the least, are left out: the density is that of the other eight.
    let (last_position, _, last_set) = stretched(1, 0.01);
    positions.extend(last_position.iter().map(|x| x + 20.0));
    indices.extend(27..30);
    sets[0]
        .as_mut()
        .expect("set 0")
        .extend(last_set[0].as_ref().expect("set"));
    let mut one = Density::default();
    one.add(&positions, &indices, &sets);
    assert_eq!(one.per_set(), Some([2.0, 0.0, 0.0, 0.0]));
    // Another primitive of the same material adds its weight before the division: the density is
    // the mean of both, a set no triangle measures staying 0.
    let (positions, indices, sets) = stretched(10, 0.0625);
    let mut both = one;
    both.add(&positions, &indices, &sets);
    assert_eq!(both.per_set(), Some([3.0, 0.0, 0.0, 0.0]));
    // A primitive with no coordinates, or whose triangles cover nothing of them, measures nothing.
    let mut none = Density::default();
    none.add(&positions, &indices, &[None, None, None, None]);
    none.add(&positions, &indices, &stretched(10, 0.0).2);
    assert_eq!(none.per_set(), None);
}
