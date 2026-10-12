use super::*;
use trillion3d_math::sphere::enclosing_sphere;

#[test]
fn bisect_centres_sorts_an_even_group_and_splits_it_in_half() {
    let centres = [
        [10.0, 0.0, 0.0],
        [10.0, 0.0, 0.0],
        [5.0, 0.0, 0.0],
        [20.0, 0.0, 0.0],
    ];
    let mut slice = [3usize, 1, 0, 2];
    bisect_centres(&mut slice, &centres);
    assert_eq!(slice, [2, 0, 1, 3]);
    let middle = slice.len() / 2;
    assert_eq!(&slice[..middle], &[2, 0]);
    assert_eq!(&slice[middle..], &[1, 3]);
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
    bisect_centres(&mut slice, &centres);
    assert_eq!(slice, [3, 4, 1, 2, 0]);
    let middle = slice.len() / 2;
    assert_eq!(&slice[..middle], &[3, 4]);
    assert_eq!(&slice[middle..], &[1, 2, 0]);
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
