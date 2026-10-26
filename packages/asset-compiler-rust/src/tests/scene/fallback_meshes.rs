//! The fallback meshes of an instanced layer that disallows the cluster DAG, in a compilation
//! (`compiler/source/fallback.rs`): the fixture triangle placed 48 × 48 times, as `world_roots.rs`.
use super::world_roots::grid_world_with;
use super::*;
use crate::hlod::chain::tests::decoded::table;
use crate::hlod::chain::{WORLD_ROOTS_BIN, WORLD_ROOTS_FILE};

// Behaviour: an instanced layer that disallows the cluster DAG keeps its objects as rows, each on the
// fallback mesh of its source: a mesh the job publishes once beside its source (its `extras` name the
// source), the partition lists with no node, and the rows of the layer's actors name.
#[test]
fn an_instanced_layer_without_a_cluster_dag_stands_its_rows_on_fallback_meshes() {
    // A row: its mesh and its track as two words, its matrix as sixteen `f64`.
    const ROW_BYTES: usize = 2 * 4 + 16 * 8;
    let hlod = crate::Hlod::read(Some(&json!({
        "layers": [
            {"name": "hlod0", "builder": "instanced", "parent": "hlod1"},
            {"name": "hlod1", "builder": "instanced", "disallowClusterDag": true,
                "cellSize": 512, "loadingRange": 1024}
        ],
        "default": "hlod0"
    })))
    .expect("the chain reads");
    let (_root, result, directory) = grid_world_with(48, json!([]), hlod);
    // The fallback is a second mesh, its source the first.
    let primitives = result["primitives"].as_array().expect("primitives");
    assert_eq!(primitives.len(), 2, "the mesh and its fallback");
    assert_eq!(primitives[1]["mesh"], json!(1));
    assert_eq!(
        primitives[1]["clusterStrategy"],
        primitives[0]["clusterStrategy"]
    );
    let source = read_json(&directory.join("source.gltf"));
    assert_eq!(source["meshes"][1]["extras"]["hlodFallbackOf"], json!(0));
    assert!(source["meshes"][0]["extras"]["hlodFallbackOf"].is_null());
    // The partition lists it with no node and no row at any rung.
    let tables = read_json(&directory.join("scene-tables.json"));
    let listed: Vec<&str> = (tables["partition"]["meshes"]
        .as_array()
        .expect("meshes")
        .iter())
    .filter_map(Value::as_str)
    .collect();
    let entry = listed
        .iter()
        .find(|e| e.starts_with("00000001"))
        .expect("the fallback listed");
    assert!(
        entry[8..].bytes().all(|b| b == b'0'),
        "no node, no row: {entry}"
    );
    // The actors' rows stand on it, none on the source.
    let table = table(&fs::read(directory.join(WORLD_ROOTS_FILE)).expect("table"));
    let payload = fs::read(directory.join(WORLD_ROOTS_BIN)).expect("payload");
    let mut meshes = BTreeSet::new();
    for cell in table["hlod"].as_array().expect("hlod") {
        let count = cell["rows"]["count"].as_u64().unwrap_or(0) as usize;
        let Some(bundle) = cell["rows"]["bundle"].as_u64() else {
            continue;
        };
        let at = table["bundles"][bundle as usize]["offset"]
            .as_u64()
            .expect("offset") as usize;
        for row in 0..count {
            let word = &payload[at + row * ROW_BYTES..at + row * ROW_BYTES + 4];
            meshes.insert(u32::from_le_bytes(word.try_into().expect("a word")));
        }
    }
    assert_eq!(meshes, BTreeSet::from([1]), "every row names the fallback");
}
