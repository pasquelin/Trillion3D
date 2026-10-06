//! The `clusters` and `groups` of the world roots, written as `world-roots.dag`: every
//! world cluster, object roots included, and the group list, published for the runtime's cut.
use super::merge::world_dag;
use super::records;
use super::tests::{cooked, covers, world};
use super::*;

#[test]
fn the_table_publishes_every_cluster_and_its_groups_for_the_runtime_cut() {
    let covers = covers();
    let instances = world(&covers, 2);
    let cooked = cooked(&instances, 4, WORLD_TOP_BUDGET_BYTES).expect("cooked");
    let world = world_dag(&instances, &|| Ok(())).expect("world");
    let clusters = cooked.table["clusters"].as_array().expect("clusters");
    let groups = cooked.table["groups"].as_array().expect("groups");
    // One entry per world cluster, object roots included, named by its world rank in order.
    assert_eq!(clusters.len(), world.clusters.len());
    for (slot, cluster) in clusters.iter().enumerate() {
        assert_eq!(cluster["cluster"].as_u64(), Some(slot as u64));
        assert_eq!(
            cluster["level"].as_u64(),
            Some(world.clusters[slot].level as u64)
        );
        assert!(cluster["sphere"].is_array());
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
    let objects: Vec<&Value> = cooked.table["cells"]
        .as_array()
        .expect("cells")
        .iter()
        .flat_map(|cell| cell["objects"].as_array().expect("objects"))
        .collect();
    let clusters = cooked.table["clusters"].as_array().expect("clusters");
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
    let mut table = cooked(&instances, 4, WORLD_TOP_BUDGET_BYTES)
        .expect("cooked")
        .table;
    table["payload"] = json!({"url":WORLD_ROOTS_BIN,"sha256":"ab".repeat(32),"bytes":5u64 << 32});
    let words = |bytes: &[u8], at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let count = |key: &str| table[key].as_array().expect(key).len();
    let lists = |values: Vec<&Value>| -> usize {
        values
            .iter()
            .map(|v| v.as_array().expect("list").len())
            .sum()
    };
    let objects: Vec<&Value> = table["cells"]
        .as_array()
        .expect("cells")
        .iter()
        .flat_map(|cell| cell["objects"].as_array().expect("objects"))
        .collect();
    let bundles = table["bundles"].as_array().expect("bundles");
    let pool = lists(bundles.iter().map(|b| &b["dependencies"]).collect())
        + lists(
            objects
                .iter()
                .flat_map(|o| [&o["roots"], &o["dependencies"]])
                .collect(),
        );
    let file = records::encode_table(&table).expect("table");
    assert_eq!(&file[..4], records::TABLE_MAGIC);
    assert_eq!(words(&file, 4), WORLD_ROOTS_VERSION);
    let counts = [
        count("bundles"),
        count("pages"),
        count("cells"),
        objects.len(),
        pool,
    ];
    assert_eq!(
        counts.map(|c| c as u32),
        [20, 24, 28, 32, 36].map(|at| words(&file, at))
    );
    assert_eq!(
        [words(&file, 40), words(&file, 44)],
        [0, 5],
        "the binary's length, 64-bit"
    );
    assert_eq!(file[48..80], [0xab; 32], "its digest, as bytes");
    let sizes = 80 + counts[0] * 56 + counts[1] * 24 + counts[2] * 8 + counts[3] * 24;
    assert_eq!(file.len(), sizes + pool * 4);
    let groups = table["groups"].as_array().expect("groups");
    let pool = lists(
        groups
            .iter()
            .flat_map(|g| [&g["children"], &g["outputs"]])
            .collect(),
    );
    let dag = records::encode_dag(&table).expect("dag");
    assert_eq!(&dag[..4], records::DAG_MAGIC);
    let counts = [count("clusters"), groups.len(), pool];
    assert_eq!(
        counts.map(|c| c as u32),
        [8, 12, 16].map(|at| words(&dag, at))
    );
    assert_eq!(dag.len(), 24 + counts[0] * 152 + counts[1] * 64 + pool * 4);
    // A root's parent error is NaN; a super-root names its bundle, an object root none.
    let root = table["clusters"]
        .as_array()
        .expect("clusters")
        .iter()
        .position(|c| c["parentError"].is_null());
    let at = 24 + root.expect("a root") * 152;
    assert!(f64::from_le_bytes(dag[at + 32..at + 40].try_into().unwrap()).is_nan());
}
