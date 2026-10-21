//! The world's culling hierarchy in `world-roots.dag`: the nodes after the groups, over the ranks the
//! clusters take in its order (`../merge.rs`, `in_culling_order`).
use super::decoded::decoded;
use super::{cooked, covers, world};

/// The DAG's culling nodes, after its groups, name its clusters by their ranks: every cluster lies in
/// exactly one leaf, and every node's box holds the boxes of the clusters below it.
#[test]
fn the_dag_carries_a_culling_hierarchy_over_its_ranks() {
    let covers = covers();
    let instances = world(&covers, 2);
    let cooked = cooked(&instances, 4).expect("cooked");
    let table = decoded(&cooked);
    let clusters = table["clusters"].as_array().expect("clusters");
    let nodes = table["culling"].as_array().expect("culling");
    let count = nodes.len();
    assert!(count > 0, "a world carries its culling hierarchy");
    // The decoded reader checks the header's counts, the records, the nodes and the pool fill the
    // file exactly.
    let node = |n: usize| -> Vec<f64> {
        (nodes[n].as_array().expect("a node").iter())
            .map(|v| v.as_f64().expect("finite"))
            .collect()
    };
    let mut owned = vec![0usize; clusters.len()];
    for n in 0..count {
        let v = node(n);
        assert!(v[12] + v[13] <= count as f64);
        let (first, pages) = (v[14] as usize, v[15] as usize);
        for rank in first..first + pages {
            owned[rank] += 1;
            let (min, max) = (&clusters[rank]["min"], &clusters[rank]["max"]);
            for a in 0..3 {
                assert!(min[a].as_f64().unwrap() >= v[a]);
                assert!(max[a].as_f64().unwrap() <= v[3 + a]);
            }
        }
    }
    assert!(owned.iter().all(|&n| n == 1), "every cluster in one leaf");
}
