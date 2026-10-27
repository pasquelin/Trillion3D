//! The flags the job's object settings carry into the node table and the cell rows: whether a
//! view's primed depth draws an object (`farField`).
//!
//! Provenance: the glTF the compilation publishes as `source.gltf`, built from the repository's own
//! triangle fixture, as `scene_tables.rs` builds its cases.
use super::scene_tables::with_bounds;
use super::*;

/// The options of a compile of a root with three nodes drawing the mesh — "left", "right" and
/// "plain" —, the job's `objectSettings.objects` being `rules`.
fn three_objects(rules: Value) -> Options {
    let (_root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    with_bounds(&mut gltf);
    gltf["scenes"] = json!([{"nodes": [0]}]);
    gltf["nodes"] = json!([
        {"name": "root", "children": [1, 2, 3]},
        {"name": "left", "mesh": 0},
        {"name": "right", "mesh": 0},
        {"name": "plain", "mesh": 0},
    ]);
    write_gltf(&options, &gltf, None);
    options.object_settings = crate::ObjectSettings::read(Some(&json!({ "objects": rules })));
    options
}

#[test]
fn an_object_naming_far_field_carries_it_in_its_core_node_or_its_cell_row() {
    // Provenance: the job's `objectSettings.farField`, read like every object setting. "left"
    // streams in a cell row; "right" is always loaded, so the core keeps it; "plain" names none.
    let options = three_objects(json!([
        {"match": "left", "farField": true},
        {"match": "right", "spatiallyLoaded": false, "farField": true},
    ]));
    let (_options, tables, directory) = partition::compiled_full(options);
    let core = tables["nodes"].as_array().expect("nodes");
    let flagged: Vec<_> = (core.iter())
        .filter(|node| node.get("farField").is_some())
        .map(|node| node["name"].clone())
        .collect();
    assert_eq!(flagged, vec![json!("right")], "{tables}");
    let rows = partition::cell_nodes(&directory);
    let far = (rows.iter())
        .filter(|row| row.get("farField") == Some(&json!(true)))
        .count();
    assert_eq!(far, 1, "the one object that streams: {rows:?}");
}
