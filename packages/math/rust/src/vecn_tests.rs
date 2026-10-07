use super::*;

#[test]
fn add_sub_and_scale_work_axis_by_axis_in_either_precision() {
    let (a, b) = ([1.0f32, 2.0, 3.0, 4.0], [0.5f32, -1.0, 0.25, 8.0]);
    assert_eq!(add(a, b), [1.5, 1.0, 3.25, 12.0]);
    assert_eq!(sub(a, b), [0.5, 3.0, 2.75, -4.0]);
    assert_eq!(scale(a, 0.5), [0.5, 1.0, 1.5, 2.0]);
    assert_eq!(add([0.1f64, 0.2], [0.2, 0.1]), [0.1 + 0.2, 0.2 + 0.1]);
}

#[test]
fn dot_sums_in_index_order_as_an_iterator_sum_does() {
    let (a, b) = ([0.1f32, 0.7, -3.3, 1e-3], [9.1f32, -0.2, 0.37, 2.5e4]);
    let by_sum: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let written = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    assert_eq!(dot(a, b).to_bits(), by_sum.to_bits());
    assert_eq!(dot(a, b).to_bits(), written.to_bits());
    // A sum of negative zeros stays negative, as `−0.0 + −0.0` is.
    assert!(dot([-0.0f64; 3], [1.0; 3]).is_sign_negative());
    let v = [0.3f64, -1.1, 7.0];
    assert_eq!(dot(v, v).to_bits(), crate::vec3::dot(v, v).to_bits());
}

#[test]
fn length_and_distance2_are_the_root_and_the_square_of_the_differences() {
    assert_eq!(squared_length([3.0f64, 4.0]), 25.0);
    assert_eq!(length([3.0f64, 4.0]), 5.0);
    assert_eq!(length([1.0f32, 2.0, 2.0, 4.0]), 5.0);
    let v = [0.3f64, -1.1, 7.0];
    assert_eq!(length(v).to_bits(), crate::vec3::length(v).to_bits());
    let (a, b) = ([1.5f32, 2.0, 0.0, 9.0], [0.5f32, 4.0, 2.0, 9.0]);
    let by_hand: f32 = a.iter().zip(b).map(|(d, v)| (d - v) * (d - v)).sum();
    assert_eq!(distance2(a, b).to_bits(), by_hand.to_bits());
    assert_eq!(distance2(a, b), 9.0);
}

#[test]
fn distance2_i32_squares_the_integer_differences() {
    assert_eq!(distance2_i32([10, 20, 30], [13, 16, 30]), 25);
    assert_eq!(distance2_i32([0; 3], [255; 3]), 3 * 255 * 255);
}

#[test]
fn lerp_starts_exactly_at_a() {
    let (a, b) = ([0.1f64, -7.3, 1e9], [0.3, 2.0, -1e-9]);
    assert_eq!(lerp(a, b, 0.0), a);
    assert_eq!(
        lerp(a, b, 0.5),
        [0, 1, 2].map(|k| a[k] + (b[k] - a[k]) * 0.5)
    );
    assert_eq!(lerp([1.0f32], [3.0], 0.25), [1.5]);
}

#[test]
fn weighted_sum_is_the_written_out_combination_and_the_iterator_sum() {
    let points = [[0.1f64, 2.0], [0.7, -0.3], [1.9, 0.45]];
    let weights = [0.2, 0.3, 0.5];
    let written = [0, 1]
        .map(|a| points[0][a] * weights[0] + points[1][a] * weights[1] + points[2][a] * weights[2]);
    let by_sum = [0, 1].map(|a| (0..3).map(|k| weights[k] * points[k][a]).sum::<f64>());
    assert_eq!(weighted_sum(points, weights), written);
    assert_eq!(weighted_sum(points, weights), by_sum);
}

#[test]
fn weighted_mean_divides_by_the_summed_weights() {
    let points = [
        [0.0, 0.0, 0.0],
        [4.0, 0.0, 2.0],
        [0.0, 8.0, 2.0],
        [4.0, 4.0, 0.0],
    ];
    assert_eq!(weighted_mean(points, [1.0, 1.0, 1.0, 1.0]), [2.0, 3.0, 1.0]);
    let weights = [0.3, 0.1, 0.7, 0.05];
    let total: f64 = weights.iter().sum();
    let by_hand = [0, 1, 2].map(|k| (0..4).map(|j| weights[j] * points[j][k]).sum::<f64>() / total);
    assert_eq!(weighted_mean(points, weights), by_hand);
}

#[test]
fn mean_sums_from_positive_zero_then_scales_by_the_reciprocal() {
    assert_eq!(mean([[1.0, 2.0, 3.0], [3.0, 4.0, 5.0]]), [2.0, 3.0, 4.0]);
    // Negative zeros summed from `+0.0` come out positive.
    assert!(mean([[-0.0f64; 3]])[0].is_sign_positive());
    let points = [[0.1, 0.2, 0.3], [0.7, 0.11, 0.13], [0.5, 0.9, 0.01]];
    let sum = points.iter().fold([0.0; 3], |s, p| crate::vec3::add(s, *p));
    assert_eq!(mean(points), crate::vec3::scale(sum, 1.0 / 3.0));
    assert!(mean(core::iter::empty::<[f64; 2]>())[0].is_nan());
}
