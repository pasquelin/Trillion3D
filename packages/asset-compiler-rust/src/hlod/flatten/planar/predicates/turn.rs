//! The adaptive orientation of three points, in either precision: the determinant
//! `(a − c) × (b − c)` = `(aₓ − cₓ)(b_y − c_y) − (a_y − c_y)(bₓ − cₓ)`.
//!
//! 1. Rounded once: returned when the two products have opposite signs or one is zero (no
//!    cancellation, the sign is right), or when its magnitude reaches the first bound times the
//!    sum of the products' magnitudes.
//! 2. The two products of the rounded differences formed exactly and subtracted into four
//!    components, summed into one float: returned when it reaches the second bound.
//! 3. Returned as it is when no difference lost anything to rounding (the four components were
//!    then the exact determinant).
//! 4. Corrected by the first-order terms of the differences' rounding errors: returned when it
//!    reaches the third bound, which adds the error of that correction.
//! 5. Otherwise the three remaining products (error × rounded twice, error × error) are added
//!    exactly to the four components, and the largest component of the exact sum is returned.
use super::expansion::{approximate, product_difference, sub_error, sum_expansions};
use super::precision::Precision;

/// Twice the signed area of `a`, `b`, `c`, its sign exact (module doc).
pub(super) fn orient_adaptive<T: Precision>(a: [T; 2], b: [T; 2], c: [T; 2]) -> T {
    let left = (a[0] - c[0]) * (b[1] - c[1]);
    let right = (a[1] - c[1]) * (b[0] - c[0]);
    let rounded = left - right;
    let magnitudes = if left > T::ZERO {
        if right <= T::ZERO {
            return rounded;
        }
        left + right
    } else if left < T::ZERO {
        if right >= T::ZERO {
            return rounded;
        }
        -left - right
    } else {
        return rounded;
    };
    let bound = T::TURN_FILTER_BOUND * magnitudes;
    if rounded >= bound || -rounded >= bound {
        return rounded;
    }
    refined(a, b, c, magnitudes)
}

/// Stages 2 to 5 of the module doc, `magnitudes` the sum of the two products' magnitudes.
fn refined<T: Precision>(a: [T; 2], b: [T; 2], c: [T; 2], magnitudes: T) -> T {
    let ac_x = a[0] - c[0];
    let bc_x = b[0] - c[0];
    let ac_y = a[1] - c[1];
    let bc_y = b[1] - c[1];
    let exact = product_difference(ac_x, bc_y, ac_y, bc_x);
    let mut value = approximate(&exact);
    let bound = T::TURN_ESTIMATE_BOUND * magnitudes;
    if value >= bound || -value >= bound {
        return value;
    }
    let ac_x_lost = sub_error(a[0], c[0], ac_x);
    let bc_x_lost = sub_error(b[0], c[0], bc_x);
    let ac_y_lost = sub_error(a[1], c[1], ac_y);
    let bc_y_lost = sub_error(b[1], c[1], bc_y);
    if ac_x_lost == T::ZERO && ac_y_lost == T::ZERO && bc_x_lost == T::ZERO && bc_y_lost == T::ZERO
    {
        return value;
    }
    let bound = T::TURN_TAIL_BOUND * magnitudes + T::RESULT_BOUND * value.magnitude();
    value = value + ((ac_x * bc_y_lost + bc_y * ac_x_lost) - (ac_y * bc_x_lost + bc_x * ac_y_lost));
    if value >= bound || -value >= bound {
        return value;
    }
    let mut first = [T::ZERO; 8];
    let first_len = sum_expansions(
        &exact,
        &product_difference(ac_x_lost, bc_y, ac_y_lost, bc_x),
        &mut first,
    );
    let mut second = [T::ZERO; 12];
    let second_len = sum_expansions(
        &first[..first_len],
        &product_difference(ac_x, bc_y_lost, ac_y, bc_x_lost),
        &mut second,
    );
    let mut whole = [T::ZERO; 16];
    let whole_len = sum_expansions(
        &second[..second_len],
        &product_difference(ac_x_lost, bc_y_lost, ac_y_lost, bc_x_lost),
        &mut whole,
    );
    whole[whole_len - 1]
}
