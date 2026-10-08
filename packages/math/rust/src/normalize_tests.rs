use super::*;
use crate::random::xorshift64;

/// Vectors of every magnitude, from their bits: `count` of them, the same on every run.
fn vectors(count: usize) -> Vec<[f64; 3]> {
    let mut state = crate::GOLDEN;
    (0..count)
        .map(|_| {
            [0, 1, 2].map(|_| {
                let bits = xorshift64(&mut state);
                // Exponents within ±64 of one: the squares neither overflow nor vanish.
                f64::from_bits((bits & 0x800F_FFFF_FFFF_FFFF) | ((959 + bits % 128) << 52))
            })
        })
        .collect()
}

#[test]
fn triple_is_the_dot_of_the_first_with_the_cross_of_the_others() {
    assert_eq!(
        triple([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
        1.0
    );
    assert_eq!(
        triple([0.0, 1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
        -1.0
    );
    for v in vectors(300).chunks(3) {
        let by_hand = dot(v[0], cross(v[1], v[2]));
        assert_eq!(triple(v[0], v[1], v[2]).to_bits(), by_hand.to_bits());
    }
}

#[test]
fn normalize_divides_each_axis_by_the_length() {
    assert_eq!(normalize([3.0, 0.0, -4.0]), [0.6, 0.0, -0.8]);
    assert!(normalize([0.0; 3])[0].is_nan());
    for v in vectors(1000) {
        let norm = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        assert_eq!(normalize(v), [v[0] / norm, v[1] / norm, v[2] / norm]);
    }
}

#[test]
fn normalize_where_leaves_the_guard_to_the_caller() {
    let v = [0.0, 3.0, 4.0];
    assert_eq!(normalize_where(v, |norm| norm > 1.0), Some(normalize(v)));
    assert_eq!(normalize_where(v, |norm| norm > 5.0), None);
}

#[test]
fn normalized_or_falls_back_at_or_under_its_guard_and_for_nan() {
    let fallback = [0.0, 0.0, -1.0];
    assert_eq!(normalized_or([0.0; 3], fallback), fallback);
    assert_eq!(normalized_or([1e-13, 0.0, 0.0], fallback), fallback);
    assert_eq!(normalized_or([f64::NAN, 0.0, 0.0], fallback), fallback);
    assert_eq!(normalized_or([3.0, 4.0, 0.0], fallback), [0.6, 0.8, 0.0]);
}

#[test]
fn unit_where_scales_by_the_reciprocal_and_rounds_apart_from_normalize() {
    let mut apart = 0;
    for v in vectors(1000) {
        let norm = length(v);
        let reciprocal = 1.0 / norm;
        let expected = [v[0] * reciprocal, v[1] * reciprocal, v[2] * reciprocal];
        assert_eq!(unit_where(v, |_| true), Some(expected));
        apart += usize::from(expected != normalize(v));
    }
    assert!(apart > 0);
    assert_eq!(unit_where([1.0, 0.0, 0.0], |_| false), None);
}

#[test]
fn unit_refuses_a_zero_or_infinite_length() {
    assert_eq!(unit([0.0, 2.0, 0.0]), Some([0.0, 1.0, 0.0]));
    assert_eq!(unit([0.0; 3]), None);
    assert_eq!(unit([f64::INFINITY, 0.0, 0.0]), None);
    assert_eq!(unit([f64::NAN, 0.0, 0.0]), None);
}

#[test]
fn unit_unless_zero_refuses_only_a_zero_length() {
    assert_eq!(unit_unless_zero([0.0; 3]), None);
    assert_eq!(unit_unless_zero([0.0, 0.0, -2.0]), Some([0.0, 0.0, -1.0]));
    assert!(unit_unless_zero([f64::INFINITY, 0.0, 0.0]).unwrap()[0].is_nan());
    assert!(unit_unless_zero([f64::NAN, 0.0, 0.0]).unwrap()[0].is_nan());
}

#[test]
fn unit_or_itself_returns_a_zero_vector_unchanged() {
    assert_eq!(unit_or_itself([0.0, -0.0, 0.0]), [0.0, -0.0, 0.0]);
    assert_eq!(unit_or_itself([0.0, 5.0, 0.0]), [0.0, 1.0, 0.0]);
    assert!(unit_or_itself([f64::INFINITY, 0.0, 0.0])[0].is_nan());
}

#[test]
fn normalize_finite_f32_divides_in_single_precision() {
    assert_eq!(normalize_finite_f32([0.0, 0.0, 2.0]), Some([0.0, 0.0, 1.0]));
    assert_eq!(normalize_finite_f32([0.0; 3]), None);
    assert_eq!(normalize_finite_f32([f32::MAX, f32::MAX, 0.0]), None);
    assert_eq!(normalize_finite_f32([f32::NAN, 0.0, 0.0]), None);
    let v = [0.3f32, -1.7, 2.9];
    let norm = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    assert_eq!(
        normalize_finite_f32(v),
        Some([v[0] / norm, v[1] / norm, v[2] / norm])
    );
}
