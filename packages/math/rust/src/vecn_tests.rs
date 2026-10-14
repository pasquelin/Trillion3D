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
}

/// The written-out sums the `[f64; 3]`, `[f64; 2]` and quaternion forms were: `vecn` gives their
/// bits on hostile floats (negative zeros, subnormals, overflow, cancellation), either precision.
#[test]
fn dot_and_length_give_the_written_out_sums_bits_at_every_width() {
    let mut state = crate::GOLDEN;
    let hostile = [-0.0, 0.0, 5e-324, -1e308, 1e308, 1e17, -1e17, 0.1, -0.3];
    for _ in 0..10_000 {
        crate::random::xorshift64(&mut state);
        let pick = |shift: u32| {
            let bits = state.rotate_left(shift);
            if bits & 3 == 0 {
                hostile[(bits >> 2) as usize % hostile.len()]
            } else {
                f64::from_bits(bits & 0xBFFF_FFFF_FFFF_FFFF)
            }
        };
        let (a, b) = ([0, 9, 18, 27].map(pick), [36, 45, 54, 63].map(pick));
        let d3 = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        let (a3, b3) = ([a[0], a[1], a[2]], [b[0], b[1], b[2]]);
        assert_eq!(dot(a3, b3).to_bits(), d3.to_bits());
        let s2 = (a[0] * a[0] + a[1] * a[1]).sqrt();
        assert_eq!(length([a[0], a[1]]).to_bits(), s2.to_bits());
        let s4 = a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3];
        assert_eq!(squared_length(a).to_bits(), s4.to_bits());
        assert_eq!(dot(a, b).to_bits(), (d3 + a[3] * b[3]).to_bits());
        let f = a3.map(|v| v as f32);
        let f3 = (f[0] * f[0] + f[1] * f[1] + f[2] * f[2]).sqrt();
        assert_eq!(length(f).to_bits(), f3.to_bits());
    }
}

#[test]
fn length_and_distance2_are_the_root_and_the_square_of_the_differences() {
    assert_eq!(squared_length([3.0f64, 4.0]), 25.0);
    assert_eq!(length([3.0f64, 4.0]), 5.0);
    assert_eq!(length([1.0f32, 2.0, 2.0, 4.0]), 5.0);
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
    let by_hand = [0, 1, 2].map(|k| (points[0][k] + points[1][k] + points[2][k]) * (1.0 / 3.0));
    assert_eq!(mean(points), by_hand);
    assert!(mean(core::iter::empty::<[f64; 2]>())[0].is_nan());
}
