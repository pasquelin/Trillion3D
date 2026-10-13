//! The world's culling hierarchy in `world-roots.dag`: the nodes after the groups, over the ranks the
//! clusters take in its order (`merge.rs`, `in_culling_order`).
use super::decoded::decoded;
use super::tests::{cooked, covers, world};
use super::*;

/// The DAG's culling nodes, after its groups, name its clusters by their ranks: every cluster lies in
/// exactly one leaf, and every node's box holds the boxes of the clusters below it.
#[test]
fn the_dag_carries_a_culling_hierarchy_over_its_ranks() {
    let covers = covers();
    let instances = world(&covers, 2);
    let cooked = cooked(&instances, 4, WORLD_TOP_BUDGET_BYTES).expect("cooked");
    let table = decoded(&cooked);
    let clusters = table["clusters"].as_array().expect("clusters");
    let dag = &cooked.dag;
    let words = |at: usize| u32::from_le_bytes(dag[at..at + 4].try_into().unwrap());
    let count = words(20) as usize;
    let at = 24 + clusters.len() * 176 + words(12) as usize * 64;
    assert!(count > 0, "a world carries its culling hierarchy");
    // The header's counts, then the records, the nodes and the pool fill the file exactly.
    let records = at + count * 120;
    assert_eq!(dag.len(), records + words(16) as usize * 4);
    let node = |n: usize| -> Vec<f64> {
        (0..15)
            .map(|k| {
                let byte = at + (n * 15 + k) * 8;
                f64::from_le_bytes(dag[byte..byte + 8].try_into().unwrap())
            })
            .collect()
    };
    let mut owned = vec![0usize; clusters.len()];
    for n in 0..count {
        let v = node(n);
        assert!(v[11] + v[12] <= count as f64);
        let (first, pages) = (v[13] as usize, v[14] as usize);
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
