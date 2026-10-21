//! The dense solver of the quadrics: LU factorisation with partial pivoting, a solve and its
//! iterative refinement.

/// LU factorisation with partial pivoting of the `n × n` row-major `a`, in place; false when a
/// pivot falls under `epsilon`: the matrix is singular.
pub(super) fn lup_factorize(a: &mut [f64], pivot: &mut [usize], n: usize, epsilon: f64) -> bool {
    for (i, p) in pivot.iter_mut().enumerate().take(n) {
        *p = i;
    }
    for i in 0..n {
        let (mut max_value, mut max_index) = (a[n * i + i].abs(), i);
        for j in i + 1..n {
            let v = a[n * j + i].abs();
            if v > max_value {
                max_value = v;
                max_index = j;
            }
        }
        if max_value < epsilon {
            return false;
        }
        if max_index != i {
            pivot.swap(i, max_index);
            for j in 0..n {
                a.swap(n * i + j, n * max_index + j);
            }
        }
        for j in i + 1..n {
            a[n * j + i] /= a[n * i + i];
            for k in i + 1..n {
                a[n * j + k] -= a[n * j + i] * a[n * i + k];
            }
        }
    }
    true
}

/// `x` solving `LU·x = b` permuted by `pivot`.
pub(super) fn lup_solve(lu: &[f64], pivot: &[usize], n: usize, b: &[f64], x: &mut [f64]) {
    for i in 0..n {
        x[i] = b[pivot[i]];
        for j in 0..i {
            x[i] -= lu[n * i + j] * x[j];
        }
    }
    for i in (0..n).rev() {
        for j in i + 1..n {
            x[i] -= lu[n * i + j] * x[j];
        }
        x[i] /= lu[n * i + i];
    }
}

/// `lup_solve` refined by up to four Newton steps against `a`; true once a step's mean squared
/// correction falls under 1e-4.
pub(super) fn lup_solve_iterate(
    a: &[f64],
    lu: &[f64],
    pivot: &[usize],
    n: usize,
    b: &[f64],
    x: &mut [f64],
) -> bool {
    lup_solve(lu, pivot, n, b, x);
    let (mut residual, mut error) = ([0.0; 4], [0.0; 4]);
    for _ in 0..4 {
        for i in 0..n {
            residual[i] = b[i];
            for j in 0..n {
                residual[i] -= a[n * i + j] * x[j];
            }
        }
        lup_solve(lu, pivot, n, &residual[..n], &mut error[..n]);
        let mut mean_squared = 0.0;
        for i in 0..n {
            x[i] += error[i];
            mean_squared += error[i] * error[i];
        }
        if mean_squared < f64::from(1e-4_f32) {
            return true;
        }
    }
    false
}
