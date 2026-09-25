//! A reduction answers for the parts it removes whole, and names only its children's vertices
//! (#484).
use super::*;

// Behaviour: a part removed whole costs the distance from its surface to the surface kept, and
// destroys it when larger than the children's error; a part that keeps a vertex costs nothing.
#[test]
fn a_part_removed_whole_costs_its_distance_to_what_is_kept() {
    // A unit triangle at the origin, kept, and one 3 m above it, 0.71 m in radius, removed.
    let positions = [
        0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 3.0, 1.0, 0.0, 3.0, 0.0, 1.0, 3.0,
    ];
    let weld = [0u32, 1, 2, 3, 4, 5];
    let source = [0, 1, 2, 3, 4, 5];
    let removed = vanished::vanished(&source, &[0, 1, 2], &positions, &weld, 0.7);
    assert!(
        (removed.distance - 3.0).abs() < 1e-9,
        "{}",
        removed.distance
    );
    assert!(
        removed.destroys,
        "a part larger than the error is destroyed"
    );
    let pruned = vanished::vanished(&source, &[0, 1, 2], &positions, &weld, 0.71);
    assert!(!pruned.destroys, "a part under the error is pruned");
    let kept = vanished::vanished(&source, &source, &positions, &weld, 0.0);
    assert_eq!((kept.distance, kept.destroys), (0.0, false));
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
