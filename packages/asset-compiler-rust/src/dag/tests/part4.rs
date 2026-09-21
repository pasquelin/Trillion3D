use super::*;
use crate::dag::culling::{CullingNode, CULLING_BRANCHING, CULLING_LEAF};

#[test]
fn the_culling_hierarchy_owns_every_cluster_once_and_bounds_its_subtree() {
    let (positions, _, dag) = build(160);
    let (order, nodes) = build_culling_bvh(&positions, &dag);
    assert_eq!(order.len(), dag.len());
    let mut sorted = order.clone();
    sorted.sort_unstable();
    assert_eq!(
        sorted,
        (0..dag.len()).collect::<Vec<_>>(),
        "the order must be a permutation"
    );
    assert!(nodes.len() > 1, "a large DAG must produce interior nodes");
    let mut covered = vec![0usize; dag.len()];
    for (index, node) in nodes.iter().enumerate() {
        // The root fans out over the levels; every spatial node stays within the branching factor.
        assert!(node.child_count <= CULLING_BRANCHING || index == 0);
        if node.child_count == 0 {
            assert!(node.cluster_count > 0 && node.cluster_count <= CULLING_LEAF);
            for slot in node.first_cluster..node.first_cluster + node.cluster_count {
                covered[order[slot]] += 1;
            }
        } else {
            assert_eq!(node.cluster_count, 0);
            assert!(node.first_child + node.child_count <= nodes.len());
        }
    }
    assert!(
        covered.iter().all(|&n| n == 1),
        "every cluster belongs to exactly one leaf"
    );
    // Each node must bound its whole subtree: box, sphere and error.
    fn check(
        nodes: &[CullingNode],
        order: &[usize],
        dag: &[DagCluster],
        positions: &[f32],
        index: usize,
    ) {
        let node = &nodes[index];
        let leaves: Vec<usize> = if node.child_count == 0 {
            order[node.first_cluster..node.first_cluster + node.cluster_count].to_vec()
        } else {
            let mut all = Vec::new();
            for child in node.first_child..node.first_child + node.child_count {
                check(nodes, order, dag, positions, child);
                let c = &nodes[child];
                for a in 0..3 {
                    assert!(c.min[a] >= node.min[a] - 1e-6 && c.max[a] <= node.max[a] + 1e-6);
                }
                all.extend(subtree(nodes, order, child));
            }
            all
        };
        for &id in &leaves {
            let cluster = &dag[id];
            let (bmin, bmax) = cluster_bounds(positions, &cluster.indices);
            for a in 0..3 {
                assert!(
                    bmin[a] >= node.min[a] - 1e-6 && bmax[a] <= node.max[a] + 1e-6,
                    "cluster outside its node box"
                );
            }
            assert!(
                cluster.parent_error <= node.max_parent_error,
                "parent error above the node bound"
            );
            let s = cluster.parent_sphere;
            let n = node.sphere;
            let d = ((s[0] - n[0]).powi(2) + (s[1] - n[1]).powi(2) + (s[2] - n[2]).powi(2)).sqrt();
            assert!(
                d + s[3] <= n[3] + 1e-6,
                "parent sphere outside the node sphere"
            );
        }
    }
    fn subtree(nodes: &[CullingNode], order: &[usize], index: usize) -> Vec<usize> {
        let node = &nodes[index];
        if node.child_count == 0 {
            return order[node.first_cluster..node.first_cluster + node.cluster_count].to_vec();
        }
        (node.first_child..node.first_child + node.child_count)
            .flat_map(|child| subtree(nodes, order, child))
            .collect()
    }
    check(&nodes, &order, &dag, &positions, 0);
}

#[test]
fn enclosing_sphere_contains_every_input() {
    let spheres = [
        [0.0, 0.0, 0.0, 1.0],
        [5.0, 0.0, 0.0, 2.0],
        [0.0, -3.0, 1.0, 0.5],
    ];
    let result = enclosing_sphere(&spheres);
    for sphere in spheres {
        let d = ((sphere[0] - result[0]).powi(2)
            + (sphere[1] - result[1]).powi(2)
            + (sphere[2] - result[2]).powi(2))
        .sqrt();
        assert!(d + sphere[3] <= result[3] + 1e-9);
    }
}
