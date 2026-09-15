use crate::dag::bounds::enclosing_sphere;
use crate::dag::{build_culling_bvh, DagCluster};
use crate::shared_math::*;

#[test]
fn extend_aabb_starts_from_an_empty_box() {
    let mut low = [f64::INFINITY; 3];
    let mut high = [f64::NEG_INFINITY; 3];
    extend_aabb(&mut low, &mut high, [2.0, -3.0, 4.0]);
    assert_eq!(low, [2.0, -3.0, 4.0]);
    assert_eq!(high, [2.0, -3.0, 4.0]);
}

#[test]
fn extend_aabb_nan_in_the_point_leaves_the_bound_unchanged() {
    let mut low = [5.0, 5.0, 5.0];
    let mut high = [5.0, 5.0, 5.0];
    extend_aabb(&mut low, &mut high, [f64::NAN, 5.0, 5.0]);
    assert_eq!(low[0].to_bits(), 5.0_f64.to_bits());
    assert_eq!(high[0].to_bits(), 5.0_f64.to_bits());
}

#[test]
fn extend_aabb_nan_in_the_bound_is_replaced_by_the_coordinate() {
    let mut low = [f64::NAN, 0.0, 0.0];
    let mut high = [f64::NAN, 0.0, 0.0];
    extend_aabb(&mut low, &mut high, [3.0, 0.0, 0.0]);
    assert_eq!(low[0].to_bits(), 3.0_f64.to_bits());
    assert_eq!(high[0].to_bits(), 3.0_f64.to_bits());
}

#[test]
fn extend_aabb_keeps_the_sign_of_negative_zero() {
    let mut low = [f64::INFINITY; 3];
    let mut high = [f64::NEG_INFINITY; 3];
    extend_aabb(&mut low, &mut high, [-0.0, -0.0, -0.0]);
    assert_eq!(low[0].to_bits(), (-0.0_f64).to_bits());
    assert_ne!(low[0].to_bits(), (0.0_f64).to_bits());
    assert_eq!(high[0].to_bits(), (-0.0_f64).to_bits());
}

#[test]
fn merge_aabb_combines_two_disjoint_boxes() {
    let mut low = [0.0, 0.0, 0.0];
    let mut high = [1.0, 1.0, 1.0];
    merge_aabb(&mut low, &mut high, [5.0, 5.0, 5.0], [6.0, 6.0, 6.0]);
    assert_eq!(low, [0.0, 0.0, 0.0]);
    assert_eq!(high, [6.0, 6.0, 6.0]);
}

#[test]
fn extend_aabb_f32_starts_from_an_empty_box() {
    let mut low = [f32::INFINITY; 3];
    let mut high = [f32::NEG_INFINITY; 3];
    extend_aabb_f32(&mut low, &mut high, [1.5, -2.5, 0.5]);
    assert_eq!(low, [1.5, -2.5, 0.5]);
    assert_eq!(high, [1.5, -2.5, 0.5]);
}

#[test]
fn longest_axis_keeps_the_first_axis_on_a_tie() {
    let axis = longest_axis(&[0.0, 0.0, 0.0], &[5.0, 5.0, 3.0]);
    assert_eq!(axis, 0);
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

#[test]
fn pad_to_4_covers_every_remainder_and_the_top_of_usize() {
    assert_eq!(pad_to_4(0), 0);
    assert_eq!(pad_to_4(1), 3);
    assert_eq!(pad_to_4(2), 2);
    assert_eq!(pad_to_4(3), 1);
    assert_eq!(pad_to_4(4), 0);
    assert_eq!(pad_to_4(5), 3);
    assert_eq!(pad_to_4(usize::MAX), 1);
    assert_eq!(pad_to_4(usize::MAX - 1), 2);
}

#[test]
fn normalized_or_falls_back_under_the_guard_and_normalizes_above_it() {
    assert_eq!(
        normalized_or([0.0, 0.0, 0.0], [0.0, 0.0, -1.0]),
        [0.0, 0.0, -1.0]
    );
    assert_eq!(
        normalized_or([1e-13, 0.0, 0.0], [0.0, 1.0, 0.0]),
        [0.0, 1.0, 0.0]
    );
    assert_eq!(
        normalized_or([3.0, 4.0, 0.0], [9.0, 9.0, 9.0]),
        [0.6, 0.8, 0.0]
    );
}

/// `node_bounds` (`dag/culling.rs`) is private; it is exercised through the public
/// `build_culling_bvh`, which calls it once for the root span and once per queued node — the two
/// blocks the relevé records as fused into it.
#[test]
fn node_bounds_merges_a_rejection_node_from_its_clusters() {
    let positions: [f32; 6 * 3] = [
        0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, // triangle A
        10.0, 10.0, 10.0, 11.0, 10.0, 10.0, 10.0, 11.0, 10.0, // triangle B
    ];
    let sphere_a = [0.0, 0.0, 0.0, 1.0];
    let sphere_b = [10.0, 10.0, 10.0, 0.5];
    let cluster = |indices: Vec<u32>, level, sphere: [f64; 4], parent_error| DagCluster {
        indices,
        level,
        lod_error: 0.0,
        parent_error,
        sphere: [0.0; 4],
        parent_sphere: sphere,
        replacement: None,
        source_rank: 0,
        group: None,
        source: None,
    };
    let clusters = vec![
        cluster(vec![0, 1, 2], 0, sphere_a, 2.0),
        cluster(vec![3, 4, 5], 1, sphere_b, 5.0),
    ];
    let (_, nodes) = build_culling_bvh(&positions, &clusters);
    let root = &nodes[0];
    assert_eq!(root.min, [0.0, 0.0, 0.0]);
    assert_eq!(root.max, [11.0, 11.0, 10.0]);
    assert_eq!(root.max_parent_error, 5.0);
    assert_eq!(root.sphere, enclosing_sphere(&[sphere_a, sphere_b]));
}
