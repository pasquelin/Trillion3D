use super::*;
use crate::dag::border::border_survived;

// Lot B3: refine_bisection replaces HashSet<usize> reconstructed per cut with
// reused boolean `present` table, reset to `false` on exit; border_survived
// replaces two HashSets with two sorted lists and merge. Same verdict in both cases.

#[test]
fn refine_bisection_on_a_single_member_slice_leaves_it_in_place_and_clears_present() {
    let slice = [0usize];
    let mut side = [0u8];
    let adjacency: Vec<Vec<(u32, u32)>> = vec![Vec::new()];
    let mut present = vec![false];
    // Zero floor: single populated side can never exceed floor of other.
    refine_bisection(&slice, &mut side, &adjacency, 0, &mut present);
    assert_eq!(side, [0u8]);
    assert!(
        present.iter().all(|&p| !p),
        "present must start over as false"
    );
}

#[test]
fn refine_bisection_moves_a_member_whose_neighbours_are_mostly_on_the_other_side() {
    // 0 and 1 side 0, 2 and 3 side 1. Member 1 weighs heavier towards 2 and 3 (weight 5 each) than
    // towards 0 (weight 1): must join side 1. Floor at 1 prevents side 0 from
    // emptying completely once 1 leaves, so 0 stays.
    let slice = [0usize, 1, 2, 3];
    let mut side = [0u8, 0, 1, 1];
    let adjacency: Vec<Vec<(u32, u32)>> = vec![
        vec![(1, 1)],
        vec![(0, 1), (2, 5), (3, 5)],
        vec![(1, 5), (3, 1)],
        vec![(1, 5), (2, 1)],
    ];
    let mut present = vec![false; 4];
    refine_bisection(&slice, &mut side, &adjacency, 1, &mut present);
    assert_eq!(
        side,
        [0u8, 1, 1, 1],
        "1 joins side 1, 0 stays protected by the floor"
    );
    assert!(
        present.iter().all(|&p| !p),
        "present must start over as false"
    );
}

#[test]
fn refine_bisection_ignores_a_neighbour_outside_the_slice() {
    // Neighbor 9 does not belong to slice: present never marks it, must
    // count as neither internal nor external.
    let slice = [0usize, 1];
    let mut side = [0u8, 1];
    let adjacency: Vec<Vec<(u32, u32)>> = vec![vec![(9, 5)], vec![]];
    let mut present = vec![false; 10];
    refine_bisection(&slice, &mut side, &adjacency, 0, &mut present);
    assert_eq!(
        side,
        [0u8, 1],
        "a neighbour outside the slice must move nothing"
    );
    assert!(present.iter().all(|&p| !p));
}

#[test]
fn border_survived_is_true_when_nothing_is_locked() {
    let merged = [0u32, 1, 2];
    let simplified: [u32; 0] = [];
    let locks = [false, false, false];
    let weld = [0u32, 1, 2];
    assert!(border_survived(&merged, &simplified, &locks, &weld));
}

#[test]
fn border_survived_detects_a_locked_vertex_lost_by_simplification() {
    let merged = [0u32, 1, 2];
    let simplified = [1u32];
    let locks = [true, false, false];
    let weld = [0u32, 1, 2];
    assert!(
        !border_survived(&merged, &simplified, &locks, &weld),
        "locked vertex 0 has vanished from the simplified list"
    );
}

#[test]
fn border_survived_follows_welding_not_raw_indices() {
    // 0 and 3 welded to same vertex (weld[0] == weld[3] == 0): 0 locked but absent
    // from simplified, yet welded double 3 still present — welding suffices.
    let merged = [0u32, 1];
    let simplified = [3u32, 1];
    let locks = [true, false, false, false];
    let weld = [0u32, 1, 2, 0];
    assert!(border_survived(&merged, &simplified, &locks, &weld));
}

#[test]
fn border_survived_handles_a_group_of_thirty_two_clusters_worth_of_corners() {
    // Group of DAG_GROUP_MAX (32) clusters of 128 triangles: 32 * 128 * 3 corners, dense locks
    // and welding, as benchmark B3 measures.
    const CORNERS: usize = DAG_GROUP_MAX * 128 * 3;
    let merged: Vec<u32> = (0..CORNERS as u32).collect();
    let simplified: Vec<u32> = merged.iter().rev().copied().collect();
    let locks: Vec<bool> = (0..CORNERS).map(|i| i % 4 == 0).collect();
    let weld: Vec<u32> = (0..CORNERS as u32).collect();
    assert!(
        border_survived(&merged, &simplified, &locks, &weld),
        "any permutation of the same list keeps every locked vertex"
    );
}
