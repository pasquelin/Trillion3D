//! The distance fields of the HLOD actors in a compilation: a layer that allows one
//! (`allowDistanceField`: an approximated layer by default, a merged or simplified one when it
//! asks) has the field of each cell's actors written beside the source meshes', in the same
//! `distanceFields.bin`, and named by the same manifest section.
//!
//! Provenance: the synthetic grid world of `world_roots.rs`, the fixture triangle placed 48 × 48
//! times, under two built layers: HLOD 1 per HLOD 0 cell, HLOD 2 on top.
use super::world_roots::grid_world_with;
use super::*;
use crate::distance_field::abi::{
    DISTANCE_FIELD_FILE, DISTANCE_FIELD_FLAG_HLOD_CELL, DISTANCE_FIELD_HEAD_BYTES,
    DISTANCE_FIELD_MESH_BYTES,
};
use crate::hlod::chain::tests::decoded::table;
use crate::hlod::chain::WORLD_ROOTS_FILE;

/// The world under the layers `lower` (HLOD 1) and `upper` (HLOD 2), each named by its settings
/// over its builder: its result, and the cells that have a field with the level of their actors.
fn compiled(lower: Value, upper: Value) -> (Value, Vec<(u64, u64)>) {
    let mut layers = vec![
        json!({"name": "hlod0", "builder": "instanced", "parent": "hlod1"}),
        json!({"name": "hlod1", "parent": "hlod2", "cellSize": 512, "loadingRange": 1024,
            "clusterDag": true}),
        json!({"name": "hlod2", "spatiallyLoaded": false, "clusterDag": true}),
    ];
    for (layer, extra) in [(1, lower), (2, upper)] {
        let own = layers[layer].as_object_mut().expect("an object");
        own.extend(extra.as_object().cloned().expect("settings"));
    }
    let chain = json!({"layers": layers, "default": "hlod0"});
    let hlod = crate::Hlod::read(Some(&chain)).expect("the chain reads");
    let (_root, result, directory) = grid_world_with(48, json!([]), hlod);
    let table = table(&fs::read(directory.join(WORLD_ROOTS_FILE)).expect("table"));
    // The records of the file, as the runtime reads them: the first word names the mesh or the
    // cell, the second holds the flags.
    let file = fs::read(directory.join(DISTANCE_FIELD_FILE)).expect("the fields' file");
    let word = |at: usize| u32::from_le_bytes(file[at..at + 4].try_into().expect("a word"));
    let count = word(8) as usize;
    let mut cells = Vec::new();
    for rank in 0..count {
        let at = DISTANCE_FIELD_HEAD_BYTES + rank * DISTANCE_FIELD_MESH_BYTES;
        if word(at + 4) & DISTANCE_FIELD_FLAG_HLOD_CELL != 0 {
            let cell = u64::from(word(at));
            let level = table["hlod"][cell as usize]["actorLevel"].as_u64();
            cells.push((cell, level.expect("the cell's actors' level")));
        }
    }
    // The manifest names the same cells, and each source mesh's field is still there.
    let named: Vec<u64> = (result["distanceFields"]["meshes"]
        .as_array()
        .expect("meshes")
        .iter())
    .filter(|field| field["hlodCell"] == json!(true))
    .map(|field| field["mesh"].as_u64().expect("a cell"))
    .collect();
    assert_eq!(
        named,
        cells.iter().map(|&(cell, _)| cell).collect::<Vec<_>>()
    );
    assert_eq!(result["worldRoots"]["actorFields"], json!(cells.len()));
    let listed = result["distanceFields"]["meshes"].as_array().map(Vec::len);
    assert_eq!(listed, Some(count), "the manifest lists every record");
    assert!(
        count > cells.len(),
        "the source mesh's field is still there"
    );
    (result, cells)
}

#[test]
fn an_approximated_layer_gets_a_field_for_its_actors_by_default_and_a_merged_one_none() {
    // HLOD 1 approximated, HLOD 2 merged: the shells have one, the merged cells none.
    let (result, cells) = compiled(
        json!({"builder": "approximate"}),
        json!({"builder": "merge"}),
    );
    let actors = result["worldRoots"]["actors"].as_array().expect("actors");
    assert!(!cells.is_empty(), "the approximated actors have a field");
    // HLOD 0 is the instanced layer: the layer under test builds the level-1 actors.
    assert!(cells.iter().all(|&(_, level)| level == 1), "{cells:?}");
    assert_eq!(cells.len() as u64, actors[1].as_u64().expect("count"));
}

#[test]
fn a_merged_layer_gets_a_field_only_when_it_asks_and_an_approximated_one_none_when_it_refuses() {
    // HLOD 1 merged asking, HLOD 2 approximated refusing: the merged cells have one, the shell none.
    let (result, cells) = compiled(
        json!({"builder": "merge", "allowDistanceField": true}),
        json!({"builder": "approximate", "allowDistanceField": false}),
    );
    let actors = result["worldRoots"]["actors"].as_array().expect("actors");
    assert!(!cells.is_empty(), "the merged actors have a field");
    // HLOD 0 is the instanced layer: the layer under test builds the level-1 actors.
    assert!(cells.iter().all(|&(_, level)| level == 1), "{cells:?}");
    assert_eq!(cells.len() as u64, actors[1].as_u64().expect("count"));
    // Both layers refusing or defaulting off leave the source meshes' fields alone.
    let (_, none) = compiled(
        json!({"builder": "merge"}),
        json!({"builder": "approximate", "allowDistanceField": false}),
    );
    assert!(none.is_empty(), "no HLOD cell has a field: {none:?}");
}
