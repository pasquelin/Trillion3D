//! The world super-roots in a compilation: a partitioned world publishes them beside its
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
    options.simplification = "qem-endpoints".into();
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    // The table's records (`compiler_world_roots/records.rs`): header words, then the bundles,
    // pages, cells (16 bytes: first object, count, each node's first in the pool) and objects.
    let table = fs::read(directory.join(WORLD_ROOTS_FILE)).expect("table");
    let word = |at: usize| u32::from_le_bytes(table[at..at + 4].try_into().expect("word")) as usize;
    assert_eq!(&table[..4], b"WRTB");
    let report = &result["worldRoots"];
    let pinned = report["pinnedTopBytes"].as_u64().expect("published") as usize;
    assert!(pinned > 0 && pinned <= WORLD_TOP_BUDGET_BYTES, "{report}");
    assert_eq!(pinned, word(16));
    let partition = cells(&directory);
    assert!(partition.len() > 1, "the world is split");
    assert_eq!(report["cells"], json!(partition.len()));
    let (bundles, pages, world) = (word(20), word(24), word(28));
    assert_eq!(world, partition.len());
    let (cell_at, mut nodes) = (80 + bundles * 56 + pages * 24, Vec::new());
    let object_at = cell_at + world * 16;
    for at in 0..world {
        let body = read_json(&directory.join(format!("scene-cell-{at}.json")));
        let (first, count) = (word(cell_at + at * 16), word(cell_at + at * 16 + 4));
        assert_eq!(count, body["nodes"].as_array().expect("nodes").len());
        nodes.extend((first..first + count).map(|object| word(object_at + object * 24) as u64));
    }
    nodes.sort_unstable();
    let placed: Vec<u64> = (0..(side * side) as u64).collect();
    assert_eq!(
        nodes, placed,
        "every placement once, in the cell that places it"
    );
    let payload = fs::read(directory.join(WORLD_ROOTS_BIN)).expect("payload");
    let digest: String = table[48..80].iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(digest, hash(&payload));
    assert_eq!(word(40) + (word(44) << 32), payload.len());
}
