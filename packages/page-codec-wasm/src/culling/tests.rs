use super::families::{families, FAMILIES};
use super::*;
use crate::split::{bisect_least_cost, sort_along};
use trillion3d_math::sequence::random::xorshift64;

/// `n` centres from `seed`, on a lattice of `cells` steps per axis so that many coincide, with a
/// NaN coordinate every `nan` centres (none for 0).
fn centres(seed: u64, n: usize, cells: u64, nan: usize) -> Vec<[f64; 3]> {
    let mut state = seed;
    (0..n)
        .map(|k| {
            let mut c = [0.0; 3].map(|_| {
                xorshift64(&mut state);
                (state % cells) as f64 * 0.5
            });
            if nan > 0 && k % nan == nan - 1 {
                c[1] = f64::NAN;
            }
            c
        })
        .collect()
}

/// The median split with each centre as its own box: what the cost weighs is the halves' spread.
fn bisect_points(slice: &mut [usize], centres: &[[f64; 3]]) -> usize {
    let at = slice.len() / 2;
    bisect_least_cost(slice, centres, |id| (centres[id], centres[id]), at)
}

#[test]
fn the_split_sorts_an_even_group_and_splits_it_in_half() {
    let centres = [
        [10.0, 0.0, 0.0],
        [10.0, 0.0, 0.0],
        [5.0, 0.0, 0.0],
        [20.0, 0.0, 0.0],
    ];
    let mut slice = [3usize, 1, 0, 2];
    let axis = bisect_points(&mut slice, &centres);
    let middle = slice.len() / 2;
    sort_along(&mut slice[..middle], &centres, axis);
    sort_along(&mut slice[middle..], &centres, axis);
    assert_eq!(slice, [2, 0, 1, 3]);
}

#[test]
fn the_split_splits_an_odd_group_with_the_larger_half_last() {
    let centres = [
        [30.0, 0.0, 0.0],
        [10.0, 0.0, 0.0],
        [20.0, 0.0, 0.0],
        [0.0, 0.0, 0.0],
        [5.0, 0.0, 0.0],
    ];
    let mut slice = [0usize, 1, 2, 3, 4];
    let axis = bisect_points(&mut slice, &centres);
    let middle = slice.len() / 2;
    sort_along(&mut slice[..middle], &centres, axis);
    sort_along(&mut slice[middle..], &centres, axis);
    assert_eq!(slice, [3, 4, 1, 2, 0]);
}

/// The selection with each half sorted on the axis gives the order a full sort on that axis gives,
/// identifier tie-breaks and NaN included: a caller that reads the halves in order (the DAG's
/// grouping) reads the bytes it read before the selection.
#[test]
fn a_selection_with_sorted_halves_is_the_full_sort() {
    for (seed, n, cells, nan) in [(1, 2, 3, 0), (2, 17, 4, 0), (3, 64, 2, 5), (4, 1001, 50, 7)] {
        let centres = centres(seed, n, cells, nan);
        let mut state = seed * 77;
        let mut slice: Vec<usize> = (0..n).collect();
        for k in (1..n).rev() {
            xorshift64(&mut state);
            slice.swap(k, (state % (k as u64 + 1)) as usize);
        }
        let mut sorted = slice.clone();
        let axis = bisect_points(&mut slice, &centres);
        sort_along(&mut sorted, &centres, axis);
        let middle = n / 2;
        sort_along(&mut slice[..middle], &centres, axis);
        sort_along(&mut slice[middle..], &centres, axis);
        assert_eq!(slice, sorted, "seed {seed}");
    }
}

/// Every part lies in exactly one leaf, which names its ranks, an inner node holds at most
/// `CULLING_FANOUT` children, and every node's box, sphere and errors bound its subtree's: its box
/// and ball hold its children's, its least own error is no larger and its largest replacement
/// error no smaller than theirs.
#[test]
fn every_family_is_owned_once_and_bounded() {
    for parts in families(FAMILIES) {
        let nodes = build_culling_bvh(&parts);
        let mut owned = vec![0; parts.len()];
        for node in &nodes {
            assert!(node.child_count <= CULLING_FANOUT);
            if node.child_count == 0 {
                if node.cluster_count == 0 {
                    continue;
                }
                let at = parts
                    .iter()
                    .position(|p| p.first == node.first_cluster)
                    .unwrap();
                assert_eq!(parts[at].count, node.cluster_count);
                assert_eq!(CullingNode::leaf(&parts[at]), *node);
                owned[at] += 1;
                continue;
            }
            assert_eq!(node.cluster_count, 0);
            for c in &nodes[node.first_child..node.first_child + node.child_count] {
                (0..3).for_each(|a| assert!(c.min[a] >= node.min[a] && c.max[a] <= node.max[a]));
                assert!(c.max_parent_error <= node.max_parent_error);
                assert!(c.min_error >= node.min_error);
                let s = c.sphere;
                let d = ((s[0] - node.sphere[0]).powi(2)
                    + (s[1] - node.sphere[1]).powi(2)
                    + (s[2] - node.sphere[2]).powi(2))
                .sqrt();
                // The ball of balls takes the larger of two nested within 1e-4 of their squared
                // distance (`balls::balls_ball`): a hundredth at most outside.
                assert!(d + s[3] <= node.sphere[3] + 1e-2);
            }
        }
        assert!(owned.iter().all(|&n| n == 1));
    }
}

/// Two parts of two levels: each level's tree is its one part, and the root holds both, its box,
/// ball and errors those of the two (`CullingNode::over`).
#[test]
fn the_root_merges_its_children() {
    let sphere_a = [0.0, 0.0, 0.0, 1.0];
    let sphere_b = [10.0, 10.0, 10.0, 0.5];
    let part = |min, max, level, sphere, min_error, parent_error, first| CullingPart {
        min,
        max,
        level,
        sphere,
        min_error,
        parent_error,
        first,
        count: 1,
    };
    let parts = [
        part([0.0; 3], [1.0, 1.0, 0.0], 0, sphere_a, 0.0, 2.0, 0),
        part([10.0; 3], [11.0, 11.0, 10.0], 1, sphere_b, 2.0, 5.0, 1),
    ];
    let nodes = build_culling_bvh(&parts);
    let root = &nodes[0];
    assert_eq!((root.first_child, root.child_count), (1, 2));
    assert_eq!(root.min, [0.0, 0.0, 0.0]);
    assert_eq!(root.max, [11.0, 11.0, 10.0]);
    assert_eq!((root.min_error, root.max_parent_error), (0.0, 5.0));
    assert_eq!(root.sphere, crate::balls::balls_ball(&[sphere_a, sphere_b]));
    // The two spheres' own ball: on their axis, reaching both far sides (17.32 / 2 + 0.75).
    let reach = (300.0f64.sqrt() + 1.5) / 2.0;
    assert!((root.sphere[3] - reach).abs() < 1e-5);
}
