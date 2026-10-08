//! The `clusters` and `groups` of the world roots, written as `world-roots.dag`: every
//! world cluster, object roots included, and the group list, published for the runtime's cut.
use super::tests::{cooked, covers, world};
use super::world::world_dag;
use super::*;
use super::{decoded::decoded, records};

#[test]
fn the_table_publishes_every_cluster_and_its_groups_for_the_runtime_cut() {
    let covers = covers();
    let instances = world(&covers, 2);
    let cooked = cooked(&instances, 4, WORLD_TOP_BUDGET_BYTES).expect("cooked");
    let world = world_dag(&instances, &|| Ok(())).expect("world");
    let table = decoded(&cooked);
    let clusters = table["clusters"].as_array().expect("clusters");
    let groups = table["groups"].as_array().expect("groups");
    // One entry per world cluster, object roots included, named by its world rank in order.
    assert_eq!(clusters.len(), world.clusters.len());
    for (slot, cluster) in clusters.iter().enumerate() {
        assert_eq!(cluster["cluster"].as_u64(), Some(slot as u64));
        assert_eq!(
            cluster["level"].as_u64(),
            Some(world.clusters[slot].level as u64)
        );
        assert!(cluster["sphere"].is_array());
        // Its primitive wears its material: each test primitive wears its own (`tests::world`).
        assert_eq!(cluster["primitive"].as_u64(), world.materials[slot]);
        let origin = world.origins[slot];
        if origin.is_some() {
            // Every instance places a covered primitive: its rank among the objects is its own.
            assert_eq!(cluster["origin"].as_u64(), origin.map(|o| o as u64));
            assert!(
                cluster["bundle"].is_null(),
                "an object root has no page of its own"
            );
        } else {
            assert!(cluster["origin"].is_null(), "a super-root has no origin");
            assert!(
                cluster["bundle"].is_u64(),
                "a super-root names its page's bundle"
            );
        }
    }
    // The groups name every child and output by world rank, with their error band and sphere.
    assert_eq!(groups.len(), world.groups.len());
    for (index, group) in groups.iter().enumerate() {
        assert_eq!(
            group["level"].as_u64(),
            Some(world.groups[index].level as u64)
        );
        assert_eq!(group["error"].as_f64(), Some(world.groups[index].error));
        let children = group["children"].as_array().expect("children");
        let outputs = group["outputs"].as_array().expect("outputs");
        assert!(!children.is_empty() && !outputs.is_empty());
        for name in children.iter().chain(outputs.iter()) {
            let rank = name.as_u64().expect("rank") as usize;
            assert!(rank < world.clusters.len(), "rank {rank} out of the world");
        }
    }
}

#[test]
fn an_object_root_names_the_table_object_that_draws_it_past_uncovered_primitives() {
    // The second primitive has no DAG (`ExactClusters`): its instances list no table object.
    let [covered, _] = covers();
    let covers = [covered, RootCover::default()];
    let instances = world(&covers, 2);
    let cooked = cooked(&instances, 4, WORLD_TOP_BUDGET_BYTES).expect("cooked");
    let world = world_dag(&instances, &|| Ok(())).expect("world");
    let table = decoded(&cooked);
    let objects: Vec<&Value> = table["cells"]
        .as_array()
        .expect("cells")
        .iter()
        .flat_map(|cell| cell["objects"].as_array().expect("objects"))
        .collect();
    let clusters = table["clusters"].as_array().expect("clusters");
    let mut named = 0;
    for (slot, instance) in world.origins.iter().enumerate() {
        let Some(instance) = *instance else { continue };
        let object = objects[clusters[slot]["origin"].as_u64().expect("origin") as usize];
        assert_eq!(
            object["node"].as_u64(),
            Some(instances[instance].node as u64)
        );
        assert_eq!(object["primitive"].as_u64(), Some(0));
        named += 1;
    }
    assert!(named > 0 && objects.len() * 2 == instances.len());
}

#[test]
fn the_table_and_its_dag_are_fixed_size_records_and_their_pools() {
    let covers = covers();
    let instances = world(&covers, 2);
    let cooked = cooked(&instances, 4, WORLD_TOP_BUDGET_BYTES).expect("cooked");
    let table = decoded(&cooked);
    let words = |bytes: &[u8], at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let count = |key: &str| table[key].as_array().expect(key).len();
    let lists =
        |values: Vec<&Value>| -> usize { values.iter().map(|v| v.as_array().unwrap().len()).sum() };
    let objects: Vec<&Value> = table["cells"]
        .as_array()
        .expect("cells")
        .iter()
        .flat_map(|cell| cell["objects"].as_array().expect("objects"))
        .collect();
    let bundles = table["bundles"].as_array().expect("bundles");
    let cells = table["cells"].as_array().expect("cells").iter();
    let pool = lists(bundles.iter().map(|b| &b["dependencies"]).collect())
        + lists(cells.map(|cell| &cell["nodes"]).collect())
        + lists(
            objects
                .iter()
                .flat_map(|o| [&o["roots"], &o["dependencies"]])
                .collect(),
        );
    let file = &cooked.table;
    assert_eq!(&file[..4], records::TABLE_MAGIC);
    assert_eq!(words(file, 4), WORLD_ROOTS_VERSION);
    let counts = [
        count("bundles"),
        count("pages"),
        count("cells"),
        objects.len(),
        pool,
    ];
    assert_eq!(
        counts.map(|c| c as u32),
        [20, 24, 28, 32, 36].map(|at| words(file, at))
    );
    let length = cooked.payload.len() as u64;
    assert_eq!(
        [words(file, 40), words(file, 44)],
        [length as u32, (length >> 32) as u32],
        "the binary's length, 64-bit"
    );
    assert_eq!(
        file[48..80],
        records::digest(&cooked.payload),
        "its digest, as bytes"
    );
    let sizes = 80 + counts[0] * 56 + counts[1] * 24 + counts[2] * 16 + counts[3] * 24;
    assert_eq!(file.len(), sizes + pool * 4);
    let groups = table["groups"].as_array().expect("groups");
    let pool = lists(
        groups
            .iter()
            .flat_map(|g| [&g["children"], &g["outputs"]])
            .collect(),
    );
    let dag = &cooked.dag;
    assert_eq!(&dag[..4], records::DAG_MAGIC);
    let counts = [count("clusters"), groups.len(), pool];
    assert_eq!(
        counts.map(|c| c as u32),
        [8, 12, 16].map(|at| words(dag, at))
    );
    assert_eq!(dag.len(), 24 + counts[0] * 176 + counts[1] * 64 + pool * 4);
    // A root's parent error is NaN; a super-root names its bundle, an object root none.
    let root = table["clusters"]
        .as_array()
        .expect("clusters")
        .iter()
        .position(|c| c["parentError"].is_null());
    let at = 24 + root.expect("a root") * 176;
    assert!(f64::from_le_bytes(dag[at + 32..at + 40].try_into().unwrap()).is_nan());
}

#[test]
fn each_cell_names_its_nodes_first_objects_one_without_any_named_none() {
    // Cell 0's first node places nothing of the world: its later nodes keep their own objects.
    let (covers, keep) = (covers(), |i: &Instance| i.cell != 0 || i.slot != 0);
    let instances: Vec<Instance> = world(&covers, 2).into_iter().filter(keep).collect();
    let cooked = cooked(&instances, 4, WORLD_TOP_BUDGET_BYTES).expect("cooked");
    let table = decoded(&cooked);
    let (nodes, objects) = (&table["cells"][0]["nodes"], &table["cells"][0]["objects"]);
    assert!(nodes[0].is_null(), "a node with no object names none");
    for slot in 1..nodes.as_array().unwrap().len() {
        let first = nodes[slot].as_u64().expect("an object") as usize;
        let node = instances
            .iter()
            .find(|i| i.cell == 0 && i.slot == slot)
            .unwrap()
            .node;
        assert_eq!(
            objects[first]["node"].as_u64(),
            Some(node as u64),
            "node {slot}"
        );
    }
    // The record: 16 bytes a cell, each node's first in the pool, none as `u32::MAX`.
    let count = nodes.as_array().unwrap().len();
    let bytes = &cooked.table;
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
    let cells_at = 80 + word(20) * 56 + word(24) * 24;
    let pool_at = cells_at + word(28) * 16 + word(32) * 24;
    assert_eq!(word(cells_at + 12), count);
    assert_eq!(word(pool_at + word(cells_at + 8) * 4), u32::MAX as usize);
}
