//! The `clusters` and `groups` of the world roots, written as `world-roots.dag`: every world
//! cluster and the group list, published for the runtime's cut.
use super::decoded::decoded;
use super::tests::{cooked, covers, tree, world};
use super::world::world_dag;
use super::*;

#[test]
fn the_table_publishes_every_cluster_and_its_groups_for_the_runtime_cut() {
    let covers = covers();
    let instances = world(&covers, 2);
    let cooked = cooked(&instances, 4).expect("cooked");
    let (world, ..) = super::tests::built(&instances, |builder| {
        world_dag(&instances, &tree(4), builder)
    })
    .expect("world");
    let table = decoded(&cooked);
    let clusters = table["clusters"].as_array().expect("clusters");
    let groups = table["groups"].as_array().expect("groups");
    // One entry per world cluster, named by its world rank in order.
    assert_eq!(clusters.len(), world.clusters.len());
    for (slot, cluster) in clusters.iter().enumerate() {
        assert_eq!(cluster["cluster"].as_u64(), Some(slot as u64));
        assert_eq!(
            cluster["level"].as_u64(),
            Some(world.clusters[slot].level as u64)
        );
        assert!(cluster["sphere"].is_array());
        // It names its actor, whose flattened material it wears.
        assert_eq!(
            cluster["material"].as_u64(),
            Some(world.actors[slot] as u64)
        );
        assert_eq!(cluster["hlod"].as_u64(), Some(world.hlod(slot) as u64));
        assert!(
            cluster["bundle"].is_u64(),
            "a cluster names its page's bundle"
        );
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
fn the_table_and_its_dag_are_fixed_size_records_and_their_pools() {
    let covers = covers();
    let instances = world(&covers, 2);
    let cooked = cooked(&instances, 4).expect("cooked");
    let table = decoded(&cooked);
    let lists =
        |values: Vec<&Value>| -> usize { values.iter().map(|v| v.as_array().unwrap().len()).sum() };
    let hlod = table["hlod"].as_array().expect("hlod");
    let bundles = table["bundles"].as_array().expect("bundles");
    // The decoded reader views each record at its rank on the bytes and checks the records, then
    // the pool of the header's length, fill each file exactly: the pools hold every list.
    let pool = lists(bundles.iter().map(|b| &b["dependencies"]).collect())
        + lists(hlod.iter().map(|h| &h["bundles"]).collect());
    assert_eq!(table["poolWords"], json!(pool));
    assert_eq!(table["version"], json!(WORLD_ROOTS_VERSION));
    assert_eq!(
        table["payload"],
        json!({"bytes": cooked.payload.len(), "sha256": crate::hex_of(digest_bytes(&cooked.payload))}),
        "the binary's 64-bit length and its digest, as bytes"
    );
    let groups = table["groups"].as_array().expect("groups");
    let pool = lists(
        groups
            .iter()
            .flat_map(|g| [&g["children"], &g["outputs"]])
            .collect(),
    );
    assert_eq!(table["dagPoolWords"], json!(pool));
    // A root's parent error is NaN, read as none.
    let clusters = table["clusters"].as_array().expect("clusters");
    assert!(
        clusters.iter().any(|c| c["parentError"].is_null()),
        "a root"
    );
}
