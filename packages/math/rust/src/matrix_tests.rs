use super::*;
use crate::rotation::rotation_matrix;

#[test]
fn translation_and_scaling_write_their_column_and_diagonal() {
    let t = translation([1.0, -2.0, 3.5]);
    assert_eq!(&t[12..15], &[1.0, -2.0, 3.5]);
    assert_eq!(t[..12], IDENTITY[..12]);
    let s = scaling([2.0, -0.0, 4.0]);
    assert_eq!([s[0], s[5], s[10], s[15]], [2.0, -0.0, 4.0, 1.0]);
    assert!(s[5].is_sign_negative());
    assert_eq!(multiply_matrix4(&t, &IDENTITY), t);
}

#[test]
fn compose_trs_scales_the_rotation_s_columns_then_writes_the_translation() {
    let r = [0.1f64, -0.7, 0.2, 0.6782329983125268];
    let (t, s) = ([4.0, 5.0, -6.0], [2.0, 0.5, -3.0]);
    let mut expected = rotation_matrix(r);
    for column in 0..3 {
        for row in 0..3 {
            expected[column * 4 + row] *= s[column];
        }
    }
    expected[12..15].copy_from_slice(&t);
    let composed = compose_trs(t, r, s);
    assert_eq!(composed.map(f64::to_bits), expected.map(f64::to_bits));
    // The identity quaternion and unit scale leave the translation alone.
    assert_eq!(
        compose_trs(t, [0.0, 0.0, 0.0, 1.0], [1.0; 3]),
        translation(t)
    );
}
