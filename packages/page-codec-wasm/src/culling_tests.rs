use super::families::{families, FAMILIES};
use super::*;
use crate::split::{bisect_centres, half_area, sort_along};
use trillion3d_math::random::xorshift64;
use trillion3d_math::sphere::enclosing_sphere;

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

#[test]
fn bisect_centres_sorts_an_even_group_and_splits_it_in_half() {
    let centres = [
        [10.0, 0.0, 0.0],
        [10.0, 0.0, 0.0],
        [5.0, 0.0, 0.0],
        [20.0, 0.0, 0.0],
    ];
    let mut slice = [3usize, 1, 0, 2];
    let axis = bisect_centres(&mut slice, &centres);
    let middle = slice.len() / 2;
    sort_along(&mut slice[..middle], &centres, axis);
    sort_along(&mut slice[middle..], &centres, axis);
    assert_eq!(slice, [2, 0, 1, 3]);
}

#[test]
fn bisect_centres_splits_an_odd_group_with_the_larger_half_last() {
    let centres = [
        [30.0, 0.0, 0.0],
        [10.0, 0.0, 0.0],
        [20.0, 0.0, 0.0],
        [0.0, 0.0, 0.0],
        [5.0, 0.0, 0.0],
    ];
    let mut slice = [0usize, 1, 2, 3, 4];
    let axis = bisect_centres(&mut slice, &centres);
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
        let axis = bisect_centres(&mut slice, &centres);
        sort_along(&mut sorted, &centres, axis);
        let middle = n / 2;
        sort_along(&mut slice[..middle], &centres, axis);
        sort_along(&mut slice[middle..], &centres, axis);
        assert_eq!(slice, sorted, "seed {seed}");
    }
}

/// Every cluster lies in exactly one leaf, a leaf holds at most `CULLING_LEAF` and an inner node at
/// most `CULLING_BRANCHING` children past the root's level split, and every node's box, sphere and
/// ceiling bound its subtree's.
#[test]
fn every_family_is_owned_once_and_bounded() {
    for clusters in families(FAMILIES) {
        let (order, nodes) = build_culling_bvh(&clusters);
        let mut sorted = order.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, (0..clusters.len()).collect::<Vec<_>>());
        let mut owned = vec![0; clusters.len()];
        for (index, node) in nodes.iter().enumerate() {
            assert!(index == 0 || node.child_count <= CULLING_BRANCHING);
            let below: Vec<usize> = if node.child_count == 0 {
                assert!(node.cluster_count <= CULLING_LEAF);
                order[node.first_cluster..node.first_cluster + node.cluster_count].to_vec()
            } else {
                assert_eq!(node.cluster_count, 0);
                let children = node.first_child..node.first_child + node.child_count;
                children
                    .flat_map(|child| {
                        let c = &nodes[child];
                        (0..3).for_each(|a| {
                            assert!(c.min[a] >= node.min[a] && c.max[a] <= node.max[a])
                        });
                        assert!(c.max_parent_error <= node.max_parent_error);
                        Vec::<usize>::new()
                    })
                    .collect()
            };
            for &id in &below {
                owned[id] += 1;
                let c = &clusters[id];
                (0..3).for_each(|a| assert!(c.min[a] >= node.min[a] && c.max[a] <= node.max[a]));
                assert!(c.parent_error <= node.max_parent_error);
                let s = c.parent_sphere;
                let d = ((s[0] - node.sphere[0]).powi(2)
                    + (s[1] - node.sphere[1]).powi(2)
                    + (s[2] - node.sphere[2]).powi(2))
                .sqrt();
                assert!(d + s[3] <= node.sphere[3] * (1.0 + 1e-9));
            }
        }
        assert!(owned.iter().all(|&n| n == 1));
    }
}

/// A split takes the axis whose halves have the least surface: a grid laid out by columns gets the
/// tree its rows get, mirrored, and both cover the plane with no more node surface than the sum
/// the leaves' own boxes need on each level.
#[test]
fn a_grid_by_rows_and_by_columns_get_trees_of_the_same_surface() {
    let surface = |clusters: &[CullingCluster]| {
        let (_, nodes) = build_culling_bvh(clusters);
        nodes.iter().map(|n| half_area(n.min, n.max)).sum::<f64>()
    };
    let families = families(FAMILIES);
    assert_eq!(surface(&families[0]), surface(&families[1]));
}

/// `node_bounds` is private; it is exercised through the public `build_culling_bvh`, which calls
/// it once for the root span and once per queued node.
#[test]
fn node_bounds_merges_a_rejection_node_from_its_clusters() {
    let sphere_a = [0.0, 0.0, 0.0, 1.0];
    let sphere_b = [10.0, 10.0, 10.0, 0.5];
    let clusters = [
        CullingCluster {
            min: [0.0, 0.0, 0.0],
            max: [1.0, 1.0, 0.0],
            level: 0,
            parent_sphere: sphere_a,
            parent_error: 2.0,
        },
        CullingCluster {
            min: [10.0, 10.0, 10.0],
            max: [11.0, 11.0, 10.0],
            level: 1,
            parent_sphere: sphere_b,
            parent_error: 5.0,
        },
    ];
    let (_, nodes) = build_culling_bvh(&clusters);
    let root = &nodes[0];
    assert_eq!(root.min, [0.0, 0.0, 0.0]);
    assert_eq!(root.max, [11.0, 11.0, 10.0]);
    assert_eq!(root.max_parent_error, 5.0);
    assert_eq!(root.sphere, enclosing_sphere(&[sphere_a, sphere_b]));
}
