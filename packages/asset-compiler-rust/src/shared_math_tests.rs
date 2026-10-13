use crate::shared_math::*;

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

// `unit` and the oracle's `unit_or_itself` share one reciprocal division and keep
// their own guards — an infinite length is refused by the first, divided by the second.
#[test]
fn unit_and_the_oracle_unit_keep_their_own_guards() {
    use trillion3d_math::vec3::unit_or_itself;
    // 49 · (1 / 49) is one ulp under 1: the reciprocal is kept, not a division.
    assert_eq!(
        unit([0.0, 49.0, 0.0]),
        Some([0.0, 49.0 * (1.0 / 49.0), 0.0])
    );
    assert_ne!(49.0 * (1.0 / 49.0), 1.0);
    assert_eq!(unit_or_itself([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
    assert_eq!(unit([f64::INFINITY, 0.0, 0.0]), None);
    assert!(unit_or_itself([f64::INFINITY, 0.0, 0.0])[0].is_nan());
}
