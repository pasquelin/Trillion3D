//! The `clusters` and `groups` keys of `world-roots.json` (#1238): every world cluster, object
//! roots included, and the group list, published for the runtime's cut.
use super::merge::world_dag;
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
