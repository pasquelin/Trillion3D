//! The cause a stalled group is given, each on a small hand-made group that has it.
use super::*;

/// What `reduce_group` makes of one group holding every triangle of `indices`, every position
/// locked when `locked`, the seam weld read from `uvs` when there is one: the reduction's
/// clusters, or the cause it stalled with.
fn reduce_whole(
    positions: &[f32],
    indices: &[u32],
    uvs: Option<&[f32]>,
    locked: bool,
) -> std::result::Result<Vec<Vec<u32>>, StallCause> {
    let children: Vec<DagCluster> = cluster_triangles(positions, indices, DAG_CLUSTER_TRIANGLES)
        .expect("clusters")
        .into_iter()
        .map(|indices| {
            let sphere = point_sphere(positions, &indices);
            DagCluster::leaf(indices, 0.0, sphere, 0)
        })
        .collect();
    let group: Vec<&DagCluster> = children.iter().collect();
    let carried: Vec<trillion3d_page_codec::encode::Attribute> = uvs
        .map(|uvs| trillion3d_page_codec::encode::Attribute {
            flag: trillion3d_page_codec::FLAG_UV,
            width: 2,
            values: uvs.to_vec(),
        })
        .into_iter()
        .collect();
    let carried: Vec<&trillion3d_page_codec::encode::Attribute> = carried.iter().collect();
    let attributes = DagAttributes { carried: &carried };
    let welds = welds::Welds::of(positions, attributes, indices);
    let locks = vec![locked; positions.len() / 3];
    let weighted = attributes.weighted();
    let input = welds.input(positions, &carried, &weighted, &locks);
    match reduce_group(&input, &group, &[]).expect("reduce") {
        Ok(reduction) => Ok(reduction.clusters),
        Err(outcome) => Err(outcome.cause),
    }
}

/// The triangles of `clusters`.
fn triangles(clusters: &[Vec<u32>]) -> usize {
    clusters.iter().map(|c| c.len() / 3).sum()
}

// Behaviour: a group already within its target — one triangle — is not simplified: its one
// parent is the triangle itself.
#[test]
fn a_single_triangle_is_its_own_parent() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let clusters = reduce_whole(&positions, &[0, 1, 2], None, false).expect("one parent");
    assert_eq!((clusters.len(), triangles(&clusters)), (1, 1));
}

// Behaviour: a lock is a price, not a wall: a sheet whose every position is locked still halves,
// the merges it cannot avoid priced past every free one.
#[test]
fn a_fully_locked_sheet_still_halves() {
    let (positions, indices) = grid(16);
    let clusters =
        reduce_whole(&positions, &indices, None, true).expect("the locked sheet reduces");
    assert!(triangles(&clusters) <= indices.len() / 6);
}

// Behaviour: triangles that touch only at their corners still halve: a collapse joins the copies
// of a point that a collapsing triangle holds, and moves every other copy on its own, so a point
// shared by many otherwise unconnected triangles is no obstacle. They used to stall as
// `unreducible`, every such point a vertex the simplifier would not move.
#[test]
fn triangles_touching_only_at_corners_still_halve() {
    let (positions, grid_indices) = grid(16);
    let lower: Vec<u32> = grid_indices
        .chunks(6)
        .flat_map(|quad| [quad[0], quad[1], quad[2]])
        .collect();
    let clusters = reduce_whole(&positions, &lower, None, false).expect("the triangles reduce");
    assert!(triangles(&clusters) <= lower.len() / 6);
}
