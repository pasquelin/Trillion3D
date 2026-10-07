use super::*;
use crate::matrix::{compose_trs, scaling, translation, IDENTITY};

/// Marsaglia's xorshift, the draws of the codec's tests.
fn xorshift(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

fn draw_matrix(state: &mut u64) -> [f64; 16] {
    core::array::from_fn(|_| (xorshift(state) >> 11) as f64 / (1u64 << 53) as f64 * 4.0 - 2.0)
}

#[test]
fn the_two_determinants_agree_on_exact_values_and_round_apart_elsewhere() {
    let m = compose_trs([1.0, 2.0, 3.0], [0.0, 0.0, 0.0, 1.0], [2.0, -3.0, 4.0]);
    assert_eq!(determinant(&m), -24.0);
    assert_eq!(determinant_by_first_row(&m), -24.0);
    let mut state = crate::GOLDEN;
    let apart = (0..1000)
        .map(|_| draw_matrix(&mut state))
        .filter(|m| determinant(m).to_bits() != determinant_by_first_row(m).to_bits())
        .count();
    assert!(apart > 0, "two orders, two roundings");
}

#[test]
fn uniform_scale_is_the_cube_root_of_the_volume() {
    assert_eq!(uniform_scale(&scaling([2.0, 4.0, 8.0])), 4.0);
    assert_eq!(uniform_scale(&scaling([-2.0, 2.0, 2.0])), 2.0);
    assert_eq!(uniform_scale(&scaling([0.0, 2.0, 2.0])), 0.0);
}

#[test]
fn longest_column_is_the_root_of_each_column_s_squares() {
    let mut state = 7u64;
    for _ in 0..1000 {
        let m = draw_matrix(&mut state);
        let by_hand = (0..3)
            .map(|c| (m[c * 4].powi(2) + m[c * 4 + 1].powi(2) + m[c * 4 + 2].powi(2)).sqrt())
            .fold(0.0f64, f64::max);
        assert_eq!(longest_column(&m).to_bits(), by_hand.to_bits());
    }
    assert_eq!(longest_column(&scaling([1.0, -3.0, 2.0])), 3.0);
}

#[test]
fn the_cofactor_carries_a_normal_by_the_inverse_transpose_times_the_determinant() {
    let m = scaling([2.0, 3.0, 4.0]);
    // `det · A⁻ᵀ` of a diagonal: `(3·4, 2·4, 2·3)`.
    assert_eq!(cofactor_direction(&m, [1.0, 1.0, 1.0]), [12.0, 8.0, 6.0]);
    assert_eq!(
        cofactor_direction(&translation([5.0; 3]), [0.0, 1.0, 0.0]),
        [0.0, 1.0, 0.0]
    );
}

#[test]
fn decompose_gives_back_a_composed_node_and_refuses_a_shear_or_a_flat_axis() {
    let (t, r, s) = ([1.0, -2.0, 3.0], [0.0, 0.6, 0.0, 0.8], [2.0, 3.0, 0.5]);
    let (t2, r2, s2) = decompose_trs(&compose_trs(t, r, s)).expect("no shear");
    assert_eq!(t2, t);
    for (a, b) in r.iter().zip(r2).chain(s.iter().zip(s2)) {
        assert!((a - b).abs() < 1e-12);
    }
    // A mirror puts its sign on the first scale.
    assert!(decompose_trs(&scaling([1.0, 1.0, -1.0])).unwrap().2[0] < 0.0);
    let mut shear = IDENTITY;
    shear[4] = 0.5;
    assert!(decompose_trs(&shear).is_none());
    assert!(decompose_trs(&scaling([1.0, 0.0, 1.0])).is_none());
}
