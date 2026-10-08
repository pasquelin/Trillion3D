//! Euler rotations: three turns about the axes (0 = X, 1 = Y, 2 = Z), listed in the order they
//! apply to the point, the first the most local. The matrix composes them the other way, from the
//! identity, the last listed first: `I · R_last · … · R_first`. A product summed from `−0.0`
//! (`multiply_matrix4`) and one summed from `+0.0` (`multiply_matrix4_from_zero`) round apart: each
//! has its own composition.

use crate::matrix::{multiply_matrix4, multiply_matrix4_from_zero, MATRIX_VALUES};
use crate::real::Real;
use crate::rotation::identity;

/// The six orders named by their letters in alphabetical order, `XYZ, XZY, YXZ, YZX, ZXY, ZYX`, each
/// the axes in the order they apply to the point.
pub const ORDERS_BY_NAME: [[usize; 3]; 6] = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
];

/// The six orders, the three cyclic ones first, `xyz, yzx, zxy, xzy, yxz, zyx`, each the axes in
/// the order they apply to the point.
pub const ORDERS_BY_CYCLE: [[usize; 3]; 6] = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
    [0, 2, 1],
    [1, 0, 2],
    [2, 1, 0],
];

/// The identity times each matrix of `turns` in turn, by `multiply_matrix4`.
#[inline]
pub fn compose_turns<T: Real>(
    turns: impl IntoIterator<Item = [T; MATRIX_VALUES]>,
) -> [T; MATRIX_VALUES] {
    turns
        .into_iter()
        .fold(identity(), |matrix, turn| multiply_matrix4(&matrix, &turn))
}

/// `compose_turns` by `multiply_matrix4_from_zero`.
#[inline]
pub fn compose_turns_from_zero<T: Real>(
    turns: impl IntoIterator<Item = [T; MATRIX_VALUES]>,
) -> [T; MATRIX_VALUES] {
    turns.into_iter().fold(identity(), |matrix, turn| {
        multiply_matrix4_from_zero(&matrix, &turn)
    })
}

/// The rotation of the Euler `order`, `turn(axis)` the matrix of the turn about `axis`: the turns
/// composed by `compose_turns`, the last axis of `order` first.
#[inline]
pub fn euler_matrix<T: Real>(
    order: [usize; 3],
    turn: impl Fn(usize) -> [T; MATRIX_VALUES],
) -> [T; MATRIX_VALUES] {
    compose_turns(order.into_iter().rev().map(turn))
}

/// `euler_matrix` by `compose_turns_from_zero`.
#[inline]
pub fn euler_matrix_from_zero<T: Real>(
    order: [usize; 3],
    turn: impl Fn(usize) -> [T; MATRIX_VALUES],
) -> [T; MATRIX_VALUES] {
    compose_turns_from_zero(order.into_iter().rev().map(turn))
}

#[cfg(test)]
#[path = "euler_tests.rs"]
mod tests;
