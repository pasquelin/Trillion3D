use super::*;
use crate::matrix::transform_point;
use crate::rotation::{axis_rotation, turn};

#[test]
fn both_tables_hold_the_six_orders_once() {
    for table in [ORDERS_BY_NAME, ORDERS_BY_CYCLE] {
        for order in table {
            let mut sorted = order;
            sorted.sort_unstable();
            assert_eq!(sorted, [0, 1, 2]);
        }
        for (i, a) in table.iter().enumerate() {
            assert!(table[i + 1..].iter().all(|b| a != b));
        }
    }
    assert_eq!(ORDERS_BY_NAME[0], ORDERS_BY_CYCLE[0]);
    assert_eq!(ORDERS_BY_NAME[5], ORDERS_BY_CYCLE[5]);
}

#[test]
fn the_first_axis_of_the_order_turns_the_point_first() {
    let quarter = core::f64::consts::FRAC_PI_2;
    // X then Z: +Y goes to +Z about X, which Z leaves; Z then X: +Y goes to −X about Z, then stays.
    let x_then_z =
        euler_matrix_from_zero([0, 2, 1], |axis| turn(axis, [quarter, 0.0, quarter][axis]));
    let z_then_x =
        euler_matrix_from_zero([2, 0, 1], |axis| turn(axis, [quarter, 0.0, quarter][axis]));
    let moved = |m: &[f64; 16]| transform_point(m, [0.0, 1.0, 0.0]).map(|v| v.round());
    assert_eq!(moved(&x_then_z), [0.0, 0.0, 1.0]);
    assert_eq!(moved(&z_then_x), [-1.0, 0.0, 0.0]);
}

#[test]
fn euler_matrix_is_the_summed_product_loop_in_single_precision() {
    let angles = [0.3f32, -1.2, 2.5];
    for order in ORDERS_BY_NAME {
        let mut by_hand = identity::<f32>();
        for axis in order.iter().rev() {
            by_hand = multiply_matrix4(&by_hand, &turn(*axis, angles[*axis]));
        }
        let composed = euler_matrix(order, |axis| turn(axis, angles[axis]));
        assert_eq!(composed.map(f32::to_bits), by_hand.map(f32::to_bits));
    }
}

#[test]
fn euler_matrix_from_zero_is_the_from_zero_product_loop() {
    let (angles, per_unit) = ([30.0f64, -75.0, 110.0], 1.0);
    for order in ORDERS_BY_CYCLE {
        let mut by_hand = crate::matrix::IDENTITY;
        for axis in order.into_iter().rev() {
            let radians = (angles[axis] * per_unit).to_radians();
            by_hand = multiply_matrix4_from_zero(&by_hand, &axis_rotation(axis, radians));
        }
        let composed = euler_matrix_from_zero(order, |axis| {
            axis_rotation(axis, (angles[axis] * per_unit).to_radians())
        });
        assert_eq!(composed.map(f64::to_bits), by_hand.map(f64::to_bits));
    }
}

#[test]
fn compose_turns_takes_any_list_of_turns() {
    let steps = [(2usize, 40.0f64), (0, -15.0)];
    let mut by_hand = crate::matrix::IDENTITY;
    for (axis, angle) in steps {
        by_hand = multiply_matrix4_from_zero(&by_hand, &turn(axis, angle.to_radians()));
    }
    let composed =
        compose_turns_from_zero(steps.map(|(axis, angle)| turn(axis, angle.to_radians())));
    assert_eq!(composed.map(f64::to_bits), by_hand.map(f64::to_bits));
    assert_eq!(compose_turns::<f64>([]), crate::matrix::IDENTITY);
    assert_eq!(compose_turns_from_zero::<f32>([]), identity::<f32>());
}

#[test]
fn the_two_compositions_keep_their_zeros_apart() {
    // A column of negative zeros: summed from `−0.0` it stays negative, from `+0.0` it does not.
    let mut flat = identity::<f64>();
    flat[..4].fill(-0.0);
    assert!(compose_turns([flat])[0].is_sign_negative());
    assert!(compose_turns_from_zero([flat])[0].is_sign_positive());
}
