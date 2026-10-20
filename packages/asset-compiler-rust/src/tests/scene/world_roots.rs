//! The world's HLOD in a compilation: a partitioned world publishes it beside its cells, one entry
//! per HLOD 0 cell, each cell naming its own.
//!
//! Provenance: the synthetic grid world of `partition.rs`, the fixture triangle placed 48 × 48
//! times, which spans several grid cells.
use super::partition::{cells, grid};
use super::*;
use crate::compiler_world_roots::decoded::table;
use crate::compiler_world_roots::{WORLD_ROOTS_BIN, WORLD_ROOTS_FILE};

/// The fixture triangle placed `side` × `side` times, wearing `materials` — its first, if any —,
/// compiled whole and simplified: its result and its cache's directory. Each placement is scaled
/// twice.
fn grid_world(side: usize, materials: Value) -> (PathBuf, Value, PathBuf) {
    let (root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["accessors"][0]["min"] = json!([0.0, 0.0, 0.0]);
    gltf["accessors"][0]["max"] = json!([1.0, 1.0, 0.0]);
    gltf["nodes"] = json!(grid(side, 4.0, 2.0));
    gltf["scenes"] = json!([{"nodes": (0..side * side).collect::<Vec<_>>()}]);
    if materials.as_array().is_some_and(|all| !all.is_empty()) {
        gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    }
    gltf["materials"] = materials;
    write_gltf(&options, &gltf, None);
    options.scope = "full".into();
    options.simplification = "qem-endpoints".into();
    options.hlod = Ok(crate::tests::fixtures::hlod_chain());
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    (root, result, directory)
}

#[test]
fn a_partitioned_world_publishes_its_hlod_cell_by_cell() {
    let side = 48;
    let (_root, result, directory) = grid_world(side, json!([]));
    // The table as a load reads it (`compiler_world_roots/decoded.rs`): its header, then each
    // HLOD cell's bundles, its parent, layer and bounds.
    let table = table(&fs::read(directory.join(WORLD_ROOTS_FILE)).expect("table"));
    let report = &result["worldRoots"];
    let partition = cells(&directory);
    assert!(partition.len() > 1, "the world is split");
    let hlod = table["hlod"].as_array().expect("hlod");
    assert_eq!(report["chainCells"], json!(hlod.len()));
    // The chain: HLOD 0 cells first, each layer's cells after, the HLOD 2 cells the top's.
    let layers: Vec<u64> = hlod
        .iter()
        .map(|h| h["level"].as_u64().expect("level"))
        .collect();
    assert!(layers.windows(2).all(|w| w[0] <= w[1]), "{layers:?}");
    assert_eq!(layers.last(), Some(&2));
    for h in hlod {
        let top = h["level"] == json!(2);
        assert_eq!(h["parent"].is_null(), top, "{h}");
    }
    let mut nodes = Vec::new();
    for cell in &partition {
        assert!(cell["hlod"][0].as_u64().expect("its HLOD 0 cell") < hlod.len() as u64);
        let body = read_json(&directory.join(cell["url"].as_str().expect("url")));
        nodes.extend(body["nodes"].as_array().expect("nodes").iter().cloned());
    }
    assert_eq!(nodes.len(), side * side, "every placement once");
    let payload = fs::read(directory.join(WORLD_ROOTS_BIN)).expect("payload");
    assert_eq!(
        table["payload"],
        json!({"bytes": payload.len(), "sha256": hash(&payload)})
    );
}

/// A blended primitive is drawn sorted, and approximated into its HLOD 1 all the same: the
/// approximation takes every primitive of a cell whatever its blend mode (`SourceCover::of`), the
/// same world, blended, publishes its HLOD, every HLOD 0 cell built.
#[test]
fn a_blended_world_publishes_its_hlod_too() {
    let (_root, result, directory) = grid_world(48, json!([{"alphaMode":"BLEND"}]));
    assert_eq!(result["primitives"][0]["pass"], "clustered-blend");
    let report = &result["worldRoots"];
    assert!(report["hlodCells"].as_u64().unwrap_or(0) > 0, "{report}");
    assert_eq!(report["builtCells"], report["chainCells"], "{report}");
    assert_eq!(report["layers"], json!(3), "HLOD 1 to HLOD 3 built");
    assert!(directory.join(WORLD_ROOTS_FILE).exists());
    assert!(cells(&directory).len() > 1, "the world is still split");
}
