use super::*;

const LOW: [f64; 3] = [-1.0, 0.0, 2.0];
const HIGH: [f64; 3] = [3.0, 1.0, 4.0];

#[test]
fn corner_takes_the_high_bound_where_its_bit_is_set() {
    assert_eq!(corner(LOW, HIGH, 0), LOW);
    assert_eq!(corner(LOW, HIGH, 7), HIGH);
    assert_eq!(corner(LOW, HIGH, 0b101), [3.0, 0.0, 4.0]);
    assert_eq!(corner([0.0, 0.0], [1.0, 2.0], 2), [0.0, 2.0]);
}

#[test]
fn corners_enumerate_the_eight_in_bit_order() {
    let all = corners(LOW, HIGH);
    for (index, point) in all.iter().enumerate() {
        let by_hand = [
            if index & 1 == 0 { LOW[0] } else { HIGH[0] },
            if index & 2 == 0 { LOW[1] } else { HIGH[1] },
            if index & 4 == 0 { LOW[2] } else { HIGH[2] },
        ];
        assert_eq!(*point, by_hand);
    }
}

#[test]
fn longest_side_folds_from_zero_by_max() {
    assert_eq!(longest_side(LOW, HIGH), 4.0);
    assert_eq!(
        longest_side([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]),
        0.0
    );
    assert_eq!(longest_side([0.0, f64::NAN], [1.0, 5.0]), 1.0);
    let by_fold = (0..3).map(|k| HIGH[k] - LOW[k]).fold(0.0, f64::max);
    assert_eq!(longest_side(LOW, HIGH), by_fold);
}

#[test]
fn longest_axis_keeps_the_first_on_a_tie_and_skips_nan() {
    assert_eq!(longest_axis(&LOW, &HIGH), 0);
    assert_eq!(longest_axis(&[0.0, 0.0, 0.0], &[1.0, 2.0, 2.0]), 1);
    assert_eq!(longest_axis(&[0.0, f64::NAN, 0.0], &[1.0, 9.0, 3.0]), 2);
    assert_eq!(longest_axis(&[f64::NAN, 0.0], &[1.0, 9.0]), 0);
}

#[test]
fn diagonal_is_the_root_of_the_squared_sides() {
    assert_eq!(diagonal([0.0, 0.0, 0.0], [2.0, 3.0, 6.0]), 7.0);
    let (low, high): ([f64; 3], [f64; 3]) = ([0.1, -0.7, 3.3], [1.9, 0.2, 4.45]);
    let by_powi = (0..3)
        .map(|a| (high[a] - low[a]).powi(2))
        .sum::<f64>()
        .sqrt();
    assert_eq!(diagonal(low, high).to_bits(), by_powi.to_bits());
    let by_vec3 = crate::vec3::length(crate::vec3::sub(high, low));
    assert_eq!(diagonal(low, high).to_bits(), by_vec3.to_bits());
}
