use super::*;

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
fn zeros_of_both_signs_order_alike_on_every_host_in_either_order() {
    for (first, second) in [(0.0, -0.0), (-0.0, 0.0)] {
        let (low, high) = aabb_of([[first], [second]]);
        assert_eq!(low[0].to_bits(), (-0.0_f64).to_bits());
        assert_eq!(high[0].to_bits(), 0.0_f64.to_bits());
        let (low, high) = aabb_of_f32([[first as f32], [second as f32]]);
        assert_eq!(low[0].to_bits(), (-0.0_f32).to_bits());
        assert_eq!(high[0].to_bits(), 0.0_f32.to_bits());
    }
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
fn centre_is_the_half_sum_of_the_corners() {
    assert_eq!(centre([0.0, -2.0, 1.0], [4.0, 2.0, 2.0]), [2.0, 0.0, 1.5]);
    assert_eq!(centre([f64::MAX; 2], [f64::MAX; 2]), [f64::INFINITY; 2]);
}
