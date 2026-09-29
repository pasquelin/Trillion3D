//! The world super-roots in a compilation (#23): a partitioned world publishes them beside its
//! cells, one entry per cell, and its cook report carries the pinned top's bytes.
//!
//! Provenance: the synthetic grid world of `partition.rs`, the fixture triangle placed 48 × 48
//! times, which outgrows one stream unit and is split into cells.
use super::partition::{cells, grid};
use super::*;
use crate::compiler_world_roots::{WORLD_ROOTS_BIN, WORLD_ROOTS_FILE, WORLD_TOP_BUDGET_BYTES};

#[test]
fn a_partitioned_world_publishes_its_super_roots_cell_by_cell() {
    let side = 48;
    let (_root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["accessors"][0]["min"] = json!([0.0, 0.0, 0.0]);
    gltf["accessors"][0]["max"] = json!([1.0, 1.0, 0.0]);
    gltf["nodes"] = json!(grid(side, 4.0, 1.0));
    gltf["scenes"] = json!([{"nodes": (0..side * side).collect::<Vec<_>>()}]);
    write_gltf(&options, &gltf, None);
    options.scope = "full".into();
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    let table = read_json(&directory.join(WORLD_ROOTS_FILE));
    let report = &result["worldRoots"];
    let pinned = report["pinnedTopBytes"].as_u64().expect("published") as usize;
    assert!(pinned > 0 && pinned <= WORLD_TOP_BUDGET_BYTES, "{report}");
    assert_eq!(report["pinnedTopBytes"], table["pinnedTopBytes"]);
    let partition = cells(&directory);
    assert!(partition.len() > 1, "the world is split");
    assert_eq!(report["cells"], json!(partition.len()));
    let world = table["cells"].as_array().expect("cells");
    assert_eq!(world.len(), partition.len());
    let mut nodes = Vec::new();
    for (at, cell) in world.iter().enumerate() {
        let body = read_json(&directory.join(format!("scene-cell-{at}.json")));
        let objects = cell["objects"].as_array().expect("objects");
        assert_eq!(
            objects.len(),
            body["nodes"].as_array().expect("nodes").len()
        );
        nodes.extend(objects.iter().map(|o| o["node"].as_u64().expect("node")));
    }
    nodes.sort_unstable();
    let placed: Vec<u64> = (0..(side * side) as u64).collect();
    assert_eq!(
        nodes, placed,
        "every placement once, in the cell that places it"
    );
    let payload = fs::read(directory.join(WORLD_ROOTS_BIN)).expect("payload");
    assert_eq!(table["payload"]["sha256"], json!(hash(&payload)));
    assert_eq!(table["payload"]["bytes"], json!(payload.len()));
}
