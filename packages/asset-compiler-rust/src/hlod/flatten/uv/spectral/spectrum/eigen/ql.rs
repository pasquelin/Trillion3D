//! Shifted QL iterations on a symmetric tridiagonal matrix, the rotations carried into the
//! eigenvector matrix, then the eigenpairs sorted largest first.
//!
//! For each diagonal entry in turn, the first sub-diagonal entry at or after it that is at most
//! `10⁻⁶` times the largest `|d| + |e|` seen so far splits the matrix. Until that split is the
//! entry itself, the matrix is shifted by the eigenvalue of its leading 2×2 block nearer the
//! entry, a rotation zeroes the split's sub-diagonal entry, and Givens rotations chase the bulge
//! back up; the shifts are summed and added back once the entry converges.
use super::{wide_root, EPSILON};

/// The eigenvalues of the tridiagonal matrix of diagonal `d` and sub-diagonal `e` (its last entry
/// zero) left in `d`, its rotations applied to the columns of `a`.
pub(super) fn diagonalize(n: usize, a: &mut [f32], d: &mut [f32], e: &mut [f32]) {
    let mut shift = 0.0f32;
    let mut maxv = 0.0f32;
    for j in 0..n {
        let temp = d[j].abs() + e[j].abs();
        if maxv < temp {
            maxv = temp;
        }
        loop {
            let split = (j..n).find(|&m| e[m].abs() <= EPSILON * maxv).unwrap_or(n);
            if split == j {
                d[j] += shift;
                e[j] = 0.0;
                break;
            }
            let m = split;
            let b = -(d[j] + d[j + 1]);
            let c = d[j] * d[j + 1] - e[j] * e[j];
            let bc = wide_root(b * b - 4.0 * c);
            let mut ks = (-b + bc) / 2.0;
            let ks1 = (-b - bc) / 2.0;
            if (d[j] - ks).abs() > (d[j] - ks1).abs() {
                ks = ks1;
            }
            for v in &mut d[j..n] {
                *v -= ks;
            }
            shift += ks;
            let mut tt = wide_root(d[m] * d[m] + e[m - 1] * e[m - 1]);
            let mut cos = d[m] / tt;
            let mut sin = e[m - 1] / tt;
            let qq = sin * sin * d[m - 1] + cos * cos * d[m] + 2.0 * sin * cos * e[m - 1];
            let mut pp = sin * sin * d[m] + cos * cos * d[m - 1] - 2.0 * sin * cos * e[m - 1];
            let mut pq = (cos * cos - sin * sin) * e[m - 1] + sin * cos * (d[m - 1] - d[m]);
            d[m] = qq;
            rotate_columns(n, a, m - 1, m, cos, sin);
            if m > j + 1 {
                let mut extra = sin * e[m - 2];
                for k in (j + 1..m).rev() {
                    let next = k - 1;
                    e[next] *= cos;
                    tt = wide_root(pq * pq + extra * extra);
                    cos = pq / tt;
                    sin = extra / tt;
                    e[next + 1] = cos * pq + sin * extra;
                    d[next + 1] = sin * sin * d[next] + cos * cos * pp + 2.0 * sin * cos * e[next];
                    pq = (cos * cos - sin * sin) * e[next] + sin * cos * (d[next] - pp);
                    pp = sin * sin * pp + cos * cos * d[next] - 2.0 * sin * cos * e[next];
                    if next > 0 {
                        extra = sin * e[next - 1];
                    }
                    rotate_columns(n, a, next, next + 1, cos, sin);
                }
            }
            d[j] = pp;
            e[j] = pq;
            if m < n {
                e[m] = 0.0;
            }
        }
    }
}

/// Columns `low` and `high` of `a` rotated: `high ← s·low + c·high`, `low ← c·low − s·high`.
fn rotate_columns(n: usize, a: &mut [f32], low: usize, high: usize, cos: f32, sin: f32) {
    for l in 0..n {
        let kept = a[l * n + high];
        a[l * n + high] = sin * a[l * n + low] + cos * kept;
        a[l * n + low] = cos * a[l * n + low] - sin * kept;
    }
}

/// The eigenvalues in `d` sorted largest first by exchanges, the columns of `a` with them.
pub(super) fn sort_descending(n: usize, a: &mut [f32], d: &mut [f32]) {
    for i in 0..n - 1 {
        for j in i + 1..n {
            if d[j] > d[i] {
                d.swap(i, j);
                for k in 0..n {
                    a.swap(k * n + i, k * n + j);
                }
            }
        }
    }
}
