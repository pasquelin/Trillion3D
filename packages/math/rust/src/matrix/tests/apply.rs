use crate::matrix::*;

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
