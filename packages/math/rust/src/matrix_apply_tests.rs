use super::*;

#[test]
fn transform_direction_drops_the_translation() {
    let mut m = translation([5.0, 6.0, 7.0]);
    m[0] = 2.0;
    assert_eq!(transform_direction(&m, [1.0, 1.0, 1.0]), [2.0, 1.0, 1.0]);
    assert_eq!(transform_point(&m, [1.0, 1.0, 1.0]), [7.0, 7.0, 8.0]);
}

#[test]
fn transform_direction_sums_the_columns_in_order() {
    let m: [f64; MATRIX_VALUES] = core::array::from_fn(|i| 0.1 + i as f64 * 0.37);
    let d = [0.3, -1.7, 2.9];
    let by_rows = [0, 1, 2].map(|r| m[r] * d[0] + m[4 + r] * d[1] + m[8 + r] * d[2]);
    let moved = transform_direction(&m, d);
    assert_eq!(moved.map(f64::to_bits), by_rows.map(f64::to_bits));
    let translated = transform_point(&m, d);
    let back = [0, 1, 2].map(|r| moved[r] + m[12 + r]);
    assert_eq!(translated.map(f64::to_bits), back.map(f64::to_bits));
}

#[test]
fn transform_point_3x4_f32_rounds_once_from_f64() {
    let identity = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    assert_eq!(
        transform_point_3x4_f32(&identity, [1.5, -2.0, 3.25]),
        [1.5, -2.0, 3.25]
    );
    let shifted = [
        0.0, 1.0, 0.0, 10.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 2.0, -1.0,
    ];
    assert_eq!(
        transform_point_3x4_f32(&shifted, [1.0, 2.0, 3.0]),
        [12.0, -1.0, 5.0]
    );
    // Summed in f64 then rounded: not the f32 sum, which rounds at each step.
    let m = [1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let p = [1.0f32, 1e-8, 0.0];
    assert_eq!(
        transform_point_3x4_f32(&m, p)[0],
        (1.0f64 + 1e-8f32 as f64) as f32
    );
    let m: [f32; AFFINE_3X4_VALUES] = core::array::from_fn(|i| 0.1 + i as f32 * 0.37);
    let p = [0.3f32, -1.7, 2.9];
    let by_hand = [0, 1, 2].map(|r| {
        (m[r * 4] as f64 * p[0] as f64
            + m[r * 4 + 1] as f64 * p[1] as f64
            + m[r * 4 + 2] as f64 * p[2] as f64
            + m[r * 4 + 3] as f64) as f32
    });
    assert_eq!(transform_point_3x4_f32(&m, p), by_hand);
}
