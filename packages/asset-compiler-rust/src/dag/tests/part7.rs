//! The cause a stalled group is given, each on a small hand-made group that has it.
use super::*;

/// The cause `reduce_group` names for one group holding every triangle of `indices`, every
/// position locked when `locked`, the seam weld read from `uvs` when there is one.
fn cause_of(positions: &[f32], indices: &[u32], uvs: Option<&[f32]>, locked: bool) -> StallCause {
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
    let welds = attributes::Welds::of(positions, DagAttributes { carried: &carried }, indices);
    let locks = vec![locked; positions.len() / 3];
    let input = welds.input(positions, &locks);
    match reduce_group(&input, &group).expect("reduce") {
        Ok(_) => panic!("the group reduced"),
        Err(outcome) => outcome.cause,
    }
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
// position copies are welded across the seams: the seams hold it.
#[test]
fn a_sheet_of_one_island_per_quad_is_seam_locked() {
    let (grid_positions, grid_indices) = grid(16);
    let (mut positions, mut uvs, mut indices) = (Vec::new(), Vec::new(), Vec::new());
    for quad in grid_indices.chunks(6) {
        let base = (positions.len() / 3) as u32;
        // The quad's corners a, a + 1, a + w, a + 1 + w, each written once for this quad alone.
        let corners = [quad[0], quad[1], quad[2], quad[4]];
        for (rank, &corner) in corners.iter().enumerate() {
            let at = corner as usize * 3;
            positions.extend_from_slice(&grid_positions[at..at + 3]);
            uvs.extend([(rank & 1) as f32, (rank >> 1) as f32]);
        }
        indices.extend([base, base + 1, base + 2, base + 1, base + 3, base + 2]);
    }
    assert_eq!(
        cause_of(&positions, &indices, Some(&uvs), false),
        StallCause::SeamLocked
    );
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
