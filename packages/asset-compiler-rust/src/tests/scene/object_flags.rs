//! The flags the job's object settings carry into the node table and the cell rows: whether an
//! object casts far shadows (`castFarShadow`), so that a sun's far-shadow test keeps it in the shadow
//! maps, and whether that test reaches it (`farShadowTest`).
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
fn an_object_naming_cast_far_shadow_carries_it_in_its_core_node_or_its_cell_row() {
    // Provenance: the job's `objectSettings.castFarShadow`, read like every object setting. "left"
    // streams in a cell row; "right" is always loaded, so the core keeps it; "plain" names none.
    let options = three_objects(json!([
        {"match": "left", "castFarShadow": true},
        {"match": "right", "spatiallyLoaded": false, "castFarShadow": true},
    ]));
    let (_options, tables, directory) = partition::compiled_full(options);
    let core = tables["nodes"].as_array().expect("nodes");
    let flagged: Vec<_> = (core.iter())
        .filter(|node| node.get("castFarShadow").is_some())
        .map(|node| node["name"].clone())
        .collect();
    assert_eq!(flagged, vec![json!("right")], "{tables}");
    let rows = partition::cell_nodes(&directory);
    let cast = (rows.iter())
        .filter(|row| row.get("castFarShadow") == Some(&json!(true)))
        .count();
    assert_eq!(cast, 1, "the one object that streams: {rows:?}");
}

#[test]
fn an_object_naming_far_shadow_test_carries_it_true_or_false_and_one_naming_none_carries_none() {
    // Provenance: the job's `objectSettings.farShadowTest`, a tri-state read like every object
    // setting: "left" (a cell row) reached, "right" (always loaded, so the core keeps it) never,
    // "plain" names none and keeps the view's rule.
    let options = three_objects(json!([
        {"match": "left", "farShadowTest": true},
        {"match": "right", "spatiallyLoaded": false, "farShadowTest": false},
    ]));
    let (_options, tables, directory) = partition::compiled_full(options);
    let core = tables["nodes"].as_array().expect("nodes");
    let named: Vec<_> = (core.iter())
        .filter(|node| node.get("farShadowTest").is_some())
        .map(|node| (node["name"].clone(), node["farShadowTest"].clone()))
        .collect();
    assert_eq!(named, vec![(json!("right"), json!(false))], "{tables}");
    let rows = partition::cell_nodes(&directory);
    let tests: Vec<_> = (rows.iter())
        .filter_map(|row| row.get("farShadowTest").cloned())
        .collect();
    assert_eq!(
        tests,
        vec![json!(true)],
        "the one object that streams: {rows:?}"
    );
}
