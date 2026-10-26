//! What streams with a cell beside its mesh: the body of an object the cooked physics moves or
//! bends, and the collider of a static object kept in the core as the frame of the nodes under it.
//! Each cell row names the source node it draws, which the runtime makes them by.
//!
//! Provenance: the site's flag (`a-cooked-flag`) and a table with a cup on it, on the repository's
//! own triangle fixture (`tests/base.rs`), as `partition.rs` builds its cases.
use super::partition::{cell_nodes, compiled_with};
use super::*;

#[test]
fn a_body_streams_with_its_cell_its_node_kept_and_every_row_naming_its_source() {
    // Provenance: the site's flag (`a-cooked-flag`, its `flag.gltf`): a lawn, a pole and a cloth
    // under one root, the cloth at [0.8, 3.4, 0] declaring `extras.physics`, here on the fixture
    // triangle; beside it a crate declaring a moving rigid body, a lid under it. Every object
    // streams in its cell, a body's with it: the cloth, which the physics bends, is an animated
    // object — its node kept, its row drawn from it —, the lid's row follows the crate's node.
    let cloth = json!({"type": "cloth", "pins": [0]});
    let body = json!({"KHR_physics_rigid_bodies": {"motion": {"mass": 1.0}}});
    let nodes = vec![
        json!({"name": "lawn", "mesh": 0}),
        json!({"name": "pole", "mesh": 0}),
        json!({"name": "flag", "mesh": 0, "translation": [0.8, 3.4, 0.0], "extras": {"physics": cloth}}),
        json!({"name": "flag on a pole", "children": [0, 1, 2]}),
        json!({"name": "crate", "translation": [5.0, 0.0, 0.0], "extensions": body, "children": [5]}),
        json!({"name": "lid", "mesh": 0}),
    ];
    let (_options, tables, directory) = compiled_with(nodes, vec![3, 4], |gltf| {
        gltf["extensionsUsed"] = json!(["KHR_physics_rigid_bodies"]);
    });
    let core: Vec<_> = (tables["nodes"].as_array().expect("nodes").iter())
        .map(|node| (node["sourceNode"].clone(), node["streamed"].clone()))
        .collect();
    let kept = |source: &str, streamed: Value| (json!(source), streamed);
    let (streams, frame) = (json!(true), Value::Null);
    assert_eq!(
        core,
        [
            kept("00000002", streams),
            kept("00000003", frame.clone()),
            kept("00000004", frame)
        ],
        "{}",
        tables["nodes"]
    );
    let mut rows: Vec<_> = (cell_nodes(&directory).iter())
        .map(|row| (row["sourceNode"].clone(), row["source"].clone()))
        .collect();
    rows.sort_by_key(|(source, _)| source.to_string());
    let row = |source: &str, drawn: Value| (json!(source), drawn);
    assert_eq!(
        rows,
        [
            row("00000000", Value::Null),
            row("00000001", Value::Null),
            row("00000002", json!(true)),
            row("00000005", Value::Null),
        ]
    );
}

#[test]
fn a_static_frame_kept_in_the_core_says_its_mesh_streams_with_its_cell() {
    // A table drawn by its cell, a cup under it: the core keeps the table as the cup's frame, its
    // mesh drawn by the row of its cell, and says so, so its collider streams with that cell.
    let nodes = vec![
        json!({"name": "table", "mesh": 0, "children": [1]}),
        json!({"name": "cup", "mesh": 0, "translation": [0.0, 1.0, 0.0]}),
    ];
    let (_options, tables, directory) = compiled_with(nodes, vec![0], |_| {});
    let table = (tables["nodes"].as_array().expect("nodes").iter())
        .find(|node| node["sourceNode"] == json!("00000000"))
        .expect("the table kept in the core");
    assert_eq!(
        (&table["mesh"], &table["meshStreams"]),
        (&Value::Null, &json!(true)),
        "{table}"
    );
    let rows: Vec<_> = (cell_nodes(&directory).iter())
        .map(|row| row["sourceNode"].clone())
        .collect();
    assert!(
        rows.contains(&json!("00000000")),
        "a row of its cell draws the table: {rows:?}"
    );
}
