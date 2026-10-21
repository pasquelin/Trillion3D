use super::*;
use crate::dag::border::Border;

/// The border of the group of `slots` among `clusters`, whose external edges `outer` counts.
fn border_of(
    (positions, weld): (&[f32], &[u32]),
    (clusters, outer): (&[Vec<u32>], &[Vec<u8>]),
    slots: &[usize],
) -> Border {
    let corners: Vec<u32> = (slots.iter())
        .flat_map(|&s| clusters[s].iter().copied())
        .collect();
    let edges: Vec<&[u8]> = slots.iter().map(|&s| &outer[s][..]).collect();
    Border::of(positions, weld, &corners, &edges)
}

#[test]
fn group_simplification_locks_shared_vertices_and_frees_the_open_boundary() {
    let Grouped {
        positions,
        indices,
        clusters,
        outer,
        groups,
    } = grouped(64);
    let lists: Vec<&[u32]> = clusters.iter().map(|c| c.as_slice()).collect();
    assert!(
        groups.len() > 1,
        "the test needs at least two groups for a shared seam"
    );
    let weld = weld_positions(&positions, &indices);
    let border = |slots: &[usize]| border_of((&positions, &weld), (&clusters, &outer), slots);
    let first = border(&groups[0][..]);
    assert!(
        (groups[0].iter()).any(|&s| lists[s].iter().any(|&v| first.locks(weld[v as usize]))),
        "neighbouring groups must share vertices"
    );
    // The sheet's own open boundary must stay free: a corner vertex used by one group only.
    let corner = indices[0];
    let mut corner_groups = groups
        .iter()
        .filter(|group| group.iter().any(|&slot| lists[slot].contains(&corner)));
    if let (Some(owner), None) = (corner_groups.next(), corner_groups.next()) {
        assert!(
            !border(&owner[..]).locks(weld[corner as usize]),
            "a vertex owned by a single group must stay free"
        );
    }

    let children: Vec<DagCluster> = clusters
        .iter()
        .enumerate()
        .map(|(i, indices)| {
            DagCluster::leaf(
                indices.clone(),
                0.0,
                bounds::points_ball(&positions, indices),
                i as u32,
            )
        })
        .collect();
    let group: Vec<&DagCluster> = groups[0].iter().map(|&slot| &children[slot]).collect();
    let edges: Vec<&[u8]> = groups[0].iter().map(|&slot| &outer[slot][..]).collect();
    let merged: Vec<u32> = group
        .iter()
        .flat_map(|c| c.indices.iter().copied())
        .collect();
    let welds = crate::dag::welds::Welds::of(&positions, DagAttributes::default(), &indices);
    let input = welds.input(&positions, &[], &[], Default::default());
    let reduction = reduce_group(&input, &group, &edges, 0).expect("reduce");
    assert!(reduction.stall.is_none(), "group must simplify");
    assert!(reduction.error > 0.0);
    let produced: usize = reduction.clusters.iter().map(|c| c.len() / 3).sum();
    assert!(produced < merged.len() / 3);
    for cluster in &reduction.clusters {
        assert!(cluster.len() / 3 <= DAG_CLUSTER_TRIANGLES);
    }
}

#[test]
fn an_isolated_sheet_simplifies_its_whole_boundary() {
    // One group covering everything: nothing is shared, so nothing is locked and the outline moves.
    let (positions, indices) = grid(16);
    let Cut { clusters, outer } =
        cluster_triangles(&positions, &indices, DAG_CLUSTER_TRIANGLES, &[]).expect("clusters");
    let slots: Vec<usize> = (0..clusters.len()).collect();
    let weld = weld_positions(&positions, &indices);
    let border = border_of((&positions, &weld), (&clusters, &outer), &slots);
    assert!(
        indices.iter().all(|&v| !border.locks(weld[v as usize])),
        "a single group locks nothing"
    );
    let children: Vec<DagCluster> = clusters
        .iter()
        .map(|indices| {
            let sphere = bounds::points_ball(&positions, indices);
            DagCluster::leaf(indices.clone(), 0.0, sphere, 0)
        })
        .collect();
    let group: Vec<&DagCluster> = children.iter().collect();
    let edges: Vec<&[u8]> = outer.iter().map(|o| &o[..]).collect();
    let welds = crate::dag::welds::Welds::of(&positions, DagAttributes::default(), &indices);
    let input = welds.input(&positions, &[], &[], Default::default());
    let reduction = reduce_group(&input, &group, &edges, 0).expect("reduce");
    assert!(reduction.stall.is_none(), "an unlocked sheet must simplify");
    let produced: usize = reduction.clusters.iter().map(|c| c.len() / 3).sum();
    assert!(
        produced <= indices.len() / 6,
        "an unlocked sheet must reach the 50% target, got {produced}"
    );
}
