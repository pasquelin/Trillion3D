//! A reduction answers for the parts it removes whole, and names only its children's vertices
//! (#484).
use super::*;
use std::collections::HashSet;

// Behaviour: a part removed whole costs its extent in the source, even when a level below left
// only a remnant of it, and the distance from its surface to the surface kept, whichever is
// larger; a part that keeps a vertex costs nothing.
#[test]
fn a_part_removed_whole_costs_its_extent_and_its_distance_to_what_is_kept() {
    // A unit triangle at the origin, kept; one 3 m above it, 1.41 m across; a part 10 m across,
    // 0.5 m above it, of a long triangle and a short one.
    let positions = [
        0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 3.0, 1.0, 0.0, 3.0, 0.0, 1.0, 3.0,
        0.0, 0.0, 0.5, 10.0, 0.0, 0.5, 0.0, 0.1, 0.5, 0.2, 0.0, 0.5,
    ];
    let weld: Vec<u32> = (0..10).collect();
    let mesh = [0, 1, 2, 3, 4, 5, 6, 7, 8, 6, 9, 8];
    let extents = vanished::part_extents(&positions, &mesh, &weld);
    let error = |source: &[u32], kept: &[u32]| {
        vanished::vanished_error(source, kept, &positions, &weld, &extents)
    };
    let far = error(&[0, 1, 2, 3, 4, 5], &[0, 1, 2]);
    assert!((far - 3.0).abs() < 1e-9, "{far}");
    let wide = error(&[0, 1, 2, 6, 7, 8, 6, 9, 8], &[0, 1, 2]);
    assert!(wide >= 10.0 - 1e-6, "a part 10 m across costs {wide}");
    // What a level below left of the wide part, its short triangle, costs the whole part's extent.
    let remnant = error(&[0, 1, 2, 6, 9, 8], &[0, 1, 2]);
    assert!(remnant >= 10.0 - 1e-6, "its remnant costs {remnant}");
    assert_eq!(error(&[0, 1, 2, 3, 4, 5], &[0, 1, 2, 3, 4, 5]), 0.0);
}

// Behaviour: separate pieces from 0.1 m to 4 m across leave the DAG one by one, each only in a
// cut whose error is at least its extent: a small piece drops early, a large one late (#484).
#[test]
fn a_separate_piece_leaves_only_a_cut_whose_error_covers_its_extent() {
    let mut mesh = super::part8::Shaded {
        positions: Vec::new(),
        normals: Vec::new(),
        indices: Vec::new(),
    };
    let mut pieces = Vec::new();
    for k in 0..144 {
        let side = [0.1, 0.25, 0.5, 1.0, 2.0, 4.0][k % 6];
        let first = mesh.positions.len() / 3;
        mesh.slab(
            [(k % 12) as f32 * 6.0, (k / 12) as f32 * 6.0],
            (side, 0.1),
            2,
        );
        let vertices: Vec<u32> = (first as u32..(mesh.positions.len() / 3) as u32).collect();
        let extent = 2.0 * crate::dag::bounds::bounding_sphere(&mesh.positions, &vertices)[3];
        pieces.push((vertices, extent));
    }
    let (dag, _) = mesh.build();
    let mut thresholds: Vec<f64> = dag.iter().map(|c| c.lod_error).collect();
    thresholds.sort_by(f64::total_cmp);
    thresholds.dedup();
    let mut left = 0;
    for t in thresholds {
        let cut: HashSet<u32> = dag
            .iter()
            .filter(|c| c.lod_error <= t && t < c.parent_error)
            .flat_map(|c| c.indices.iter().copied())
            .collect();
        for (vertices, extent) in &pieces {
            if !vertices.iter().any(|v| cut.contains(v)) {
                assert!(
                    *extent <= t + 1e-6,
                    "a piece {extent} m across left at error {t}"
                );
                left += 1;
            }
        }
    }
    assert!(left > 0, "some piece leaves the DAG");
}

// Behaviour: on a mesh written quad by quad, every vertex of a coarse cluster is one its group's
// children draw, never an identical twin another group holds.
#[test]
fn coarse_clusters_name_only_their_childrens_vertices() {
    let (grid_positions, grid_indices) = grid(48);
    let (mut positions, mut indices) = (Vec::new(), Vec::new());
    for quad in grid_indices.chunks(6) {
        let mut own = std::collections::HashMap::new();
        for &v in quad {
            let next = (positions.len() / 3) as u32;
            indices.push(*own.entry(v).or_insert_with(|| {
                positions.extend_from_slice(&grid_positions[v as usize * 3..v as usize * 3 + 3]);
                next
            }));
        }
    }
    let (dag, groups, _) = build_of(&positions, &indices);
    assert!(!groups.is_empty());
    for group in &groups {
        let children: std::collections::HashSet<u32> = group
            .children
            .iter()
            .flat_map(|&c| dag[c].indices.iter().copied())
            .collect();
        for &output in &group.outputs {
            let foreign = dag[output].indices.iter().find(|v| !children.contains(v));
            assert_eq!(foreign, None, "level {} group", group.level);
        }
    }
}
