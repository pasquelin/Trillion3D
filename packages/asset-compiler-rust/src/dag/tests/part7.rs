//! The cause a stalled group is given, each on a small hand-made group that has it.
use super::*;

/// The cause `reduce_group` names for one group holding every triangle of `indices`, every
/// position locked when `locked`, the seam weld read from `uvs` when there is one.
fn cause_of(positions: &[f32], indices: &[u32], uvs: Option<&[f32]>, locked: bool) -> StallCause {
    match reduced(positions, indices, uvs, locked) {
        Ok(_) => panic!("the group reduced"),
        Err(outcome) => outcome.cause,
    }
}

/// What `reduce_group` makes of that group.
fn reduced(
    positions: &[f32],
    indices: &[u32],
    uvs: Option<&[f32]>,
    locked: bool,
) -> std::result::Result<GroupReduction, GroupOutcome> {
    let children: Vec<DagCluster> = cluster_triangles(positions, indices, DAG_CLUSTER_TRIANGLES)
        .expect("clusters")
        .into_iter()
        // Left to the attribute-aware simplification batch (#46), which rewrites these tests.
        // jscpd:ignore-start
        .map(|indices| {
            let sphere = bounding_sphere(positions, &indices);
            DagCluster {
                indices,
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
    // jscpd:ignore-end
    let carried: Vec<crate::geometry_page::Attribute> = uvs
        .map(|uvs| crate::geometry_page::Attribute {
            flag: crate::geometry_page::FLAG_UV,
            width: 2,
            values: uvs.to_vec(),
        })
        .into_iter()
        .collect();
    let carried: Vec<&crate::geometry_page::Attribute> = carried.iter().collect();
    let attributes = DagAttributes { carried: &carried };
    let welds = welds::Welds::of(positions, attributes, indices);
    let locks = vec![locked; positions.len() / 3];
    let (weighted, bound) = (attributes.weighted(), quality::NORMAL_DEVIATION_BOUND);
    let input = welds.input(positions, &carried, &weighted, &locks, bound);
    reduce_group(&input, &group).expect("reduce")
}

// Behaviour: a group of one triangle has nothing to halve.
#[test]
fn a_single_triangle_is_too_small() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    assert_eq!(
        cause_of(&positions, &[0, 1, 2], None, false),
        StallCause::TooSmall
    );
}

// Behaviour: a sheet whose every position is shared with a neighbour halves once the locks are
// lifted: its border holds it.
#[test]
fn a_fully_locked_sheet_is_border_locked() {
    let (positions, indices) = grid(16);
    assert_eq!(
        cause_of(&positions, &indices, None, true),
        StallCause::BorderLocked
    );
}

// Behaviour: a sheet laid out one texture island per quad stalls unlocked, and halves once its
// position copies are welded across the seams: the seams hold it, and the group is reduced with
// solved vertices instead (`solved.rs`), which only a `seam-locked` diagnosis runs.
#[test]
fn a_sheet_of_one_island_per_quad_is_seam_locked_and_solved() {
    let (positions, uvs, indices) = island_per_quad(16);
    let reduction = reduced(&positions, &indices, Some(&uvs), false).expect("solved");
    let placed = reduction.placed.expect("placed vertices");
    assert!(!placed.positions.is_empty());
    let source = (positions.len() / 3) as u32;
    let corners = reduction.clusters.iter().flatten();
    assert!(
        corners.clone().any(|&v| v >= source),
        "a coarse corner is placed"
    );
    let triangles: usize = reduction.clusters.iter().map(|c| c.len() / 3).sum();
    assert!(triangles < indices.len() / 3);
}

// Behaviour: triangles that touch only at their corners stall with no lock and no seam: every
// position is a complex vertex the simplifier keeps, so the surface itself resists.
#[test]
fn triangles_touching_only_at_corners_are_unreducible() {
    let (positions, grid_indices) = grid(16);
    let lower: Vec<u32> = grid_indices
        .chunks(6)
        .flat_map(|quad| [quad[0], quad[1], quad[2]])
        .collect();
    assert_eq!(
        cause_of(&positions, &lower, None, false),
        StallCause::Unreducible
    );
}
