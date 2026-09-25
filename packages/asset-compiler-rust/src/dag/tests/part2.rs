use super::*;
use std::collections::HashSet;

#[test]
fn group_simplification_pins_shared_vertices_and_frees_the_open_boundary() {
    let Grouped {
        positions,
        indices,
        clusters,
        groups,
    } = grouped(64);
    let lists: Vec<&[u32]> = clusters.iter().map(|c| c.as_slice()).collect();
    assert!(
        groups.len() > 1,
        "the test needs at least two groups for a shared seam"
    );
    let weld = weld_positions(&positions, &indices);
    let locks = level_locks(&weld, &lists, &groups);
    assert!(
        locks.iter().any(|&locked| locked),
        "neighbouring groups must share vertices"
    );
    // The sheet's own open boundary must stay free: a corner vertex used by one group only.
    let corner = indices[0];
    let corner_groups = groups
        .iter()
        .filter(|group| group.iter().any(|&slot| lists[slot].contains(&corner)))
        .count();
    if corner_groups == 1 {
        assert!(
            !locks[corner as usize],
            "a vertex owned by a single group must stay free"
        );
    }

    let children: Vec<DagCluster> = clusters
        .iter()
        .enumerate()
        .map(|(i, indices)| {
            let sphere = bounding_sphere(&positions, indices);
            DagCluster {
                indices: indices.clone(),
                level: 0,
                lod_error: 0.0,
                parent_error: f64::INFINITY,
                sphere,
                parent_sphere: sphere,
                replacement: None,
                source_rank: i as u32,
                group: None,
                source: None,
            }
        })
        .collect();
    let group: Vec<&DagCluster> = groups[0].iter().map(|&slot| &children[slot]).collect();
    let merged: Vec<u32> = group
        .iter()
        .flat_map(|c| c.indices.iter().copied())
        .collect();
    let welds = attributes::Welds::of(&positions, DagAttributes::default(), &indices);
    let input = welds.input(&positions, &locks, quality::NORMAL_DEVIATION_BOUND);
    let reduction = reduce_group(&input, &group)
        .expect("reduce")
        .expect("group must simplify");
    assert!(reduction.error > 0.0);
    let produced: usize = reduction.clusters.iter().map(|c| c.len() / 3).sum();
    assert!(produced < merged.len() / 3);
    for cluster in &reduction.clusters {
        assert!(cluster.len() / 3 <= DAG_CLUSTER_TRIANGLES);
    }
    let kept: HashSet<u32> = reduction
        .clusters
        .iter()
        .flat_map(|c| c.iter())
        .map(|&id| weld[id as usize])
        .collect();
    for &id in &merged {
        if locks[id as usize] {
            assert!(
                kept.contains(&weld[id as usize]),
                "a vertex shared with another group was dropped: crack"
            );
        }
    }
}

#[test]
fn an_isolated_sheet_simplifies_its_whole_boundary() {
    // One group covering everything: nothing is shared, so nothing is locked and the outline moves.
    let (positions, indices) = grid(16);
    let clusters =
        cluster_triangles(&positions, &indices, DAG_CLUSTER_TRIANGLES).expect("clusters");
    let lists: Vec<&[u32]> = clusters.iter().map(|c| c.as_slice()).collect();
    let groups = vec![(0..clusters.len()).collect::<Vec<_>>()];
    let weld = weld_positions(&positions, &indices);
    let locks = level_locks(&weld, &lists, &groups);
    assert!(
        locks.iter().all(|&locked| !locked),
        "a single group locks nothing"
    );
    let children: Vec<DagCluster> = clusters
        .iter()
        .map(|indices| {
            let sphere = bounding_sphere(&positions, indices);
            DagCluster {
                indices: indices.clone(),
                level: 0,
                lod_error: 0.0,
                parent_error: f64::INFINITY,
                sphere,
                parent_sphere: sphere,
                replacement: None,
                source_rank: 0,
                group: None,
                source: None,
            }
        })
        .collect();
    let group: Vec<&DagCluster> = children.iter().collect();
    let welds = attributes::Welds::of(&positions, DagAttributes::default(), &indices);
    let input = welds.input(&positions, &locks, quality::NORMAL_DEVIATION_BOUND);
    let reduction = reduce_group(&input, &group)
        .expect("reduce")
        .expect("an unlocked sheet must simplify");
    let produced: usize = reduction.clusters.iter().map(|c| c.len() / 3).sum();
    assert!(
        produced <= indices.len() / 6,
        "an unlocked sheet must reach the 50% target, got {produced}"
    );
}
