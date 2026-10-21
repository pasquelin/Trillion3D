use super::*;
use crate::dag::bounds::cluster_bounds;
use trillion3d_math::vector::vecn::{length, sub};
use trillion3d_page_codec::culling::{CullingNode, CULLING_FANOUT};

#[test]
fn the_culling_hierarchy_owns_every_cluster_once_and_bounds_its_subtree() {
    let (positions, indices) = grid(160);
    let (dag, groups, _, positions) = build_of(&positions, &indices);
    let (order, nodes) = crate::compiler::hierarchy::test_hierarchy(&positions, (&dag, &groups));
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
    for node in &nodes {
        assert!(node.child_count <= CULLING_FANOUT);
        if node.child_count == 0 {
            // A leaf is a group part: clusters of one group, or one root.
            assert!(node.cluster_count > 0);
            let ranks = node.first_cluster..node.first_cluster + node.cluster_count;
            let group = dag[order[node.first_cluster]].group;
            assert!(group.is_some() || node.cluster_count == 1);
            for rank in ranks {
                assert_eq!(dag[order[rank]].group, group, "a part of one group");
                covered[order[rank]] += 1;
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
            assert!(
                cluster.lod_error >= node.min_error,
                "own error under the node floor"
            );
            let s = cluster.parent_sphere;
            let n = node.sphere;
            let d = length(sub([s[0], s[1], s[2]], [n[0], n[1], n[2]]));
            // The ball of balls takes the larger of two nested within 1e-4 of their squared
            // distance (`balls_ball`): a hundredth at most outside.
            assert!(
                d + s[3] <= n[3] + 1e-2,
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
