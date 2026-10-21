//! The last stage of the in-circle test: every term of the determinant that carries a rounding
//! error of a relative coordinate, added exactly to the expansion of the rounded coordinates'
//! determinant, in a fixed order — the order decides the components of every partial sum, so the
//! largest one returned.
//!
//! For corner `p`, the corners `q` and `r` after it (in the order `a`, `b`, `c`, cyclically):
//!
//! 1. the squared length of `p`, exactly, when a coordinate of `q` or `r` lost something;
//! 2. for each nonzero error of each corner, in corner then axis order: the error times the cross
//!    product of `q` and `r`, times twice the rounded coordinate, plus the error times two squared
//!    lengths times a coordinate of `q` or `r` — for `x`, `|r|²·q_y` and `−|q|²·r_y`; for `y`,
//!    `|q|²·r_x` and `−|r|²·q_x`;
//! 3. for each corner with an error, in corner order: the cross product of `q` and `r` formed with
//!    their errors to first and to second order — zero when neither has any —, and for each
//!    nonzero error `e` of `p`, `x` first: `e` times the error-times-cross of step 2 plus `e` times
//!    twice the rounded coordinate times the first-order cross; then, for `x` only, `|r|²·e` times
//!    `q_y`'s error and `|q|²·(−e)` times `r_y`'s error, each when that error is not zero; then
//!    `e²` times the first-order cross plus `e` times the second-order cross times twice the
//!    rounded coordinate and times `e`.
use super::super::expansion::{
    product_difference, product_sum, scaled, square_sum, sum_expansions,
};
use super::{Corner, Running};

/// The error-carrying terms of the determinant of `corners` added to `running` (module doc);
/// `crosses[i]` is the exact cross product of the two corners after corner `i`.
pub(super) fn add_tails(corners: &[Corner; 3], crosses: &[[f64; 4]; 3], running: &mut Running) {
    let lost = |corner: &Corner| corner.x_lost != 0.0 || corner.y_lost != 0.0;
    let mut norms = [[0.0; 4]; 3];
    for (p, norm) in norms.iter_mut().enumerate() {
        if lost(&corners[(p + 1) % 3]) || lost(&corners[(p + 2) % 3]) {
            *norm = square_sum(corners[p].x, corners[p].y);
        }
    }
    // Each error times the cross product of the two other corners, `[corner][axis]`.
    let mut by_cross = [[([0.0; 8], 0); 2]; 3];
    for p in 0..3 {
        let (q, r) = ((p + 1) % 3, (p + 2) % 3);
        let corner = &corners[p];
        if corner.x_lost != 0.0 {
            by_cross[p][0] = norm_terms(
                corner.x_lost,
                &crosses[p],
                2.0 * corner.x,
                [(&norms[r], corners[q].y), (&norms[q], -corners[r].y)],
                running,
            );
        }
        if corner.y_lost != 0.0 {
            by_cross[p][1] = norm_terms(
                corner.y_lost,
                &crosses[p],
                2.0 * corner.y,
                [(&norms[q], corners[r].x), (&norms[r], -corners[q].x)],
                running,
            );
        }
    }
    for p in 0..3 {
        let corner = &corners[p];
        if !lost(corner) {
            continue;
        }
        let (q, r) = (&corners[(p + 1) % 3], &corners[(p + 2) % 3]);
        let mut first_order = [0.0; 8];
        let (first_order_len, second_order, second_order_len) = if lost(q) || lost(r) {
            let len = sum_expansions(
                &product_sum(q.x_lost, r.y, q.x, r.y_lost),
                &product_sum(r.x_lost, -q.y, r.x, -q.y_lost),
                &mut first_order,
            );
            (
                len,
                product_difference(q.x_lost, r.y_lost, r.x_lost, q.y_lost),
                4,
            )
        } else {
            (1, [0.0; 4], 1)
        };
        let crossed = (
            &first_order[..first_order_len],
            &second_order[..second_order_len],
        );
        if corner.x_lost != 0.0 {
            let (cross, cross_len) = &by_cross[p][0];
            let error_terms = [
                (q.y_lost != 0.0).then_some((&norms[(p + 2) % 3], corner.x_lost, q.y_lost)),
                (r.y_lost != 0.0).then_some((&norms[(p + 1) % 3], -corner.x_lost, r.y_lost)),
            ];
            cross_terms(
                corner.x_lost,
                &cross[..*cross_len],
                2.0 * corner.x,
                crossed,
                error_terms,
                running,
            );
        }
        if corner.y_lost != 0.0 {
            let (cross, cross_len) = &by_cross[p][1];
            cross_terms(
                corner.y_lost,
                &cross[..*cross_len],
                2.0 * corner.y,
                crossed,
                [None, None],
                running,
            );
        }
    }
}

/// Step 2 of the module doc for one error `lost`: `lost · cross · twice` plus, for each `(norm,
/// factor)`, `lost · norm · factor`, added to `running`; `lost · cross` returned, with its length.
fn norm_terms(
    lost: f64,
    cross: &[f64; 4],
    twice: f64,
    norms: [(&[f64; 4], f64); 2],
    running: &mut Running,
) -> ([f64; 8], usize) {
    let mut by_cross = [0.0; 8];
    let by_cross_len = scaled(cross, lost, &mut by_cross);
    let mut first = [0.0; 16];
    let first_len = scaled(&by_cross[..by_cross_len], twice, &mut first);
    let mut by_norm = [0.0; 8];
    let mut second = [0.0; 16];
    let by_norm_len = scaled(norms[0].0, lost, &mut by_norm);
    let second_len = scaled(&by_norm[..by_norm_len], norms[0].1, &mut second);
    let mut third = [0.0; 16];
    let by_norm_len = scaled(norms[1].0, lost, &mut by_norm);
    let third_len = scaled(&by_norm[..by_norm_len], norms[1].1, &mut third);
    let mut pair = [0.0; 32];
    let pair_len = sum_expansions(&first[..first_len], &second[..second_len], &mut pair);
    let mut all = [0.0; 48];
    let all_len = sum_expansions(&third[..third_len], &pair[..pair_len], &mut all);
    running.add(&all[..all_len]);
    (by_cross, by_cross_len)
}

/// Step 3 of the module doc for one error `lost` of a corner whose error-times-cross is
/// `by_cross`, against `crossed` (the first- and second-order cross products of the two other
/// corners); `error_terms` are the `(norm, lost, other error)` products added between the first-
/// and the second-order terms.
fn cross_terms(
    lost: f64,
    by_cross: &[f64],
    twice: f64,
    (first_order, second_order): (&[f64], &[f64]),
    error_terms: [Option<(&[f64; 4], f64, f64)>; 2],
    running: &mut Running,
) {
    let mut first = [0.0; 16];
    let first_len = scaled(by_cross, lost, &mut first);
    let mut by_first = [0.0; 16];
    let by_first_len = scaled(first_order, lost, &mut by_first);
    let mut doubled = [0.0; 32];
    let doubled_len = scaled(&by_first[..by_first_len], twice, &mut doubled);
    let mut sum = [0.0; 48];
    let sum_len = sum_expansions(&first[..first_len], &doubled[..doubled_len], &mut sum);
    running.add(&sum[..sum_len]);
    for (norm, by, other) in error_terms.into_iter().flatten() {
        let mut by_norm = [0.0; 8];
        let by_norm_len = scaled(norm, by, &mut by_norm);
        let mut term = [0.0; 16];
        let term_len = scaled(&by_norm[..by_norm_len], other, &mut term);
        running.add(&term[..term_len]);
    }
    let mut squared = [0.0; 32];
    let squared_len = scaled(&by_first[..by_first_len], lost, &mut squared);
    let mut by_second = [0.0; 8];
    let by_second_len = scaled(second_order, lost, &mut by_second);
    let mut second_doubled = [0.0; 16];
    let second_doubled_len = scaled(&by_second[..by_second_len], twice, &mut second_doubled);
    let mut second_squared = [0.0; 16];
    let second_squared_len = scaled(&by_second[..by_second_len], lost, &mut second_squared);
    let mut second_sum = [0.0; 32];
    let second_sum_len = sum_expansions(
        &second_doubled[..second_doubled_len],
        &second_squared[..second_squared_len],
        &mut second_sum,
    );
    let mut all = [0.0; 64];
    let all_len = sum_expansions(
        &squared[..squared_len],
        &second_sum[..second_sum_len],
        &mut all,
    );
    running.add(&all[..all_len]);
}
