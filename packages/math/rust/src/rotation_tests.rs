use super::*;
use crate::matrix::{multiply_matrix4, multiply_matrix4_from_zero};

// The Alembic and Blender drivers' product keeps a column of negative zeros negative; the
// glTF one writes a positive zero there.
#[test]
fn the_summed_product_keeps_the_sign_of_a_zero_the_one_from_zero_drops() {
    let mut left = identity::<f64>();
    left[0] = -0.0;
    for step in 1..4 {
        left[step * 4] = -1.0;
    }
    let right = identity::<f64>();
    assert!(multiply_matrix4(&left, &right)[0].is_sign_negative());
    assert!(multiply_matrix4_from_zero(&left, &right)[0].is_sign_positive());
}

// A turn from sine and cosine (Blender, USD) rounds apart from the same turn by
// its quaternion (Maya): the two stay, each driver keeping its own bits.
#[test]
fn a_turn_by_sine_and_cosine_rounds_apart_from_one_by_quaternion() {
    let radians = (-90.0f64).to_radians();
    assert_eq!(turn(0, radians)[5].to_bits(), radians.cos().to_bits());
    assert_ne!(
        turn(0, radians)[5].to_bits(),
        axis_rotation(0, radians)[5].to_bits()
    );
    assert_eq!(turn(2, 0.5f32)[0].to_bits(), 0.5f32.cos().to_bits());
}

#[test]
fn identity_is_the_matrix_constant_in_either_precision() {
    assert_eq!(identity::<f64>(), IDENTITY);
    assert_eq!(identity::<f32>(), IDENTITY.map(|v| v as f32));
    assert_eq!(rotation_matrix([0.0, 0.0, 0.0, 1.0f64]), IDENTITY);
}

#[test]
fn a_wxyz_quaternion_is_divided_by_its_length_unless_the_guard_refuses_it() {
    let q = [2.0f64, 0.0, 2.0, 0.0];
    let length = 8.0f64.sqrt();
    let expected = rotation_matrix([0.0, 2.0 / length, 0.0, 2.0 / length]);
    assert_eq!(quaternion_wxyz(q, |l| l > 0.0), expected);
    assert_eq!(quaternion_wxyz(q, |_| false), IDENTITY);
    assert_eq!(quaternion_wxyz([0.0f32; 4], |l| l != 0.0), identity());
}

#[test]
fn the_half_angle_quaternion_is_cosine_first_then_the_axis_times_the_sine() {
    let angle = 1.25f32;
    let half = angle / 2.0;
    let q = half_angle_wxyz([0.0, 1.0, 0.0], angle);
    assert_eq!(
        q.map(f32::to_bits),
        [half.cos(), 0.0, half.sin(), 0.0].map(f32::to_bits)
    );
    // A negative sine gives the zero axes a negative zero, which an axis quaternion does not.
    assert!(half_angle_wxyz([0.0f64, 1.0, 0.0], -1.0)[1].is_sign_negative());
}

#[test]
fn rodrigues_turns_about_its_axis_and_an_unusable_axis_rotates_nothing() {
    let quarter = core::f64::consts::FRAC_PI_2;
    let m = axis_angle([0.0, 0.0, 2.0], quarter);
    // X goes to Y.
    assert!((m[0]).abs() < 1e-15 && (m[1] - 1.0).abs() < 1e-15);
    assert_eq!(axis_angle([0.0; 3], 1.0), IDENTITY);
    assert_eq!(axis_angle([f64::NAN, 0.0, 0.0], 1.0), IDENTITY);
}

#[test]
fn a_rotation_s_quaternion_gives_back_its_matrix_on_every_branch() {
    // The trace branch, then the x, y and z ones.
    for q in [
        [0.1, -0.2, 0.3, 0.9273618495495703],
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.8, 0.6, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ] {
        let m = rotation_matrix(q);
        let r = [0, 1, 2].map(|c| [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]]);
        let back = rotation_matrix(rotation_quaternion(r));
        for (a, b) in m.iter().zip(back) {
            assert!((a - b).abs() < 1e-12, "{q:?}");
        }
    }
}
