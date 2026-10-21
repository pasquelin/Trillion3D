//! The eigenvalues and eigenvectors of a symmetric matrix in single precision, largest first:
//! Householder reduction to tridiagonal form, the reflections accumulated into the orthogonal
//! matrix, then shifted QL iterations on the tridiagonal matrix (`ql`).
//!
//! The reduction runs from the last row up: each row's part left of the diagonal, when its
//! absolute sum reaches `10⁻⁶`, is scaled by that sum and reflected onto the sub-diagonal; entries
//! the update leaves under `10⁻⁶` become zero. The accumulation then applies each stored
//! reflection to the rows above it. Square roots are taken in double precision and rounded.
use crate::hlod::flatten::uv::spectral::util::root64;

mod ql;

/// Values under this are zero.
const EPSILON: f32 = 1.0e-6;

/// `x`'s square root through double precision, zero below zero.
fn wide_root(x: f32) -> f32 {
    root64(x as f64) as f32
}

/// The `wanted` largest eigenvalues of the `n`×`n` symmetric `matrix`, and their eigenvectors,
/// each contiguous; `None` for no dimension or more wanted than there are.
pub(super) fn largest(n: usize, matrix: &[f32], wanted: usize) -> Option<(Vec<f32>, Vec<f32>)> {
    if n < wanted || wanted == 0 || n == 0 {
        return None;
    }
    let mut a = matrix[..n * n].to_vec();
    let mut sub = vec![0f32; n];
    let mut d = vec![0f32; n];
    let mut u: Vec<f32> = a[(n - 1) * n..n * n].to_vec();
    let mut p = vec![0f32; n];
    for i in (1..n).rev() {
        let total = u[..i].iter().fold(0.0f32, |sum, &x| sum + x.abs());
        let mut h = 0.0f32;
        if total < EPSILON {
            u[i] = 0.0;
            for j in 0..i {
                u[j] = a[(i - 1) * n + j];
                a[i * n + j] = 0.0;
                a[j * n + i] = 0.0;
            }
        } else {
            let scale = 1.0 / total;
            for x in &mut u[..i] {
                *x *= scale;
            }
            h = u[..i].iter().fold(0.0, |sum, &x| sum + x * x);
            let g = if u[i - 1] < 0.0 {
                -wide_root(h)
            } else {
                wide_root(h)
            };
            sub[i] = -(total * g);
            h += u[i - 1] * g;
            u[i - 1] += g;
            p[..i].fill(0.0);
            for j in 0..i {
                a[j * n + i] = u[j];
                p[j] += a[j * n + j] * u[j];
                for k in 0..j {
                    p[j] += a[j * n + k] * u[k];
                    p[k] += a[j * n + k] * u[j];
                }
            }
            let inverse = 1.0 / h;
            for x in &mut p[..i] {
                *x *= inverse;
            }
            let up = (0..i).fold(0.0f32, |sum, j| sum + u[j] * p[j]);
            let k_factor = up / (h + h);
            for j in 0..i {
                p[j] -= k_factor * u[j];
            }
            for j in 0..i {
                for k in j..i {
                    let entry = &mut a[k * n + j];
                    *entry -= p[k] * u[j] + p[j] * u[k];
                    if entry.abs() < EPSILON {
                        *entry = 0.0;
                    }
                }
            }
            for j in 0..i {
                u[j] = a[(i - 1) * n + j];
                a[i * n + j] = 0.0;
            }
        }
        u[i] = h;
    }
    for i in 0..n - 1 {
        d[i] = a[i * n + i];
        a[i * n + i] = 1.0;
        let current = i + 1;
        if u[current].abs() > EPSILON {
            for j in 0..current {
                let mut delta = 0.0f32;
                for k in 0..current {
                    delta += a[k * n + j] * a[k * n + current];
                }
                for k in 0..=i {
                    a[k * n + j] -= delta * a[k * n + current] / u[current];
                }
            }
        }
        for k in 0..=i {
            a[k * n + current] = 0.0;
        }
    }
    d[n - 1] = a[(n - 1) * n + n - 1];
    a[(n - 1) * n + n - 1] = 1.0;
    a[(n - 1) * n..(n - 1) * n + n - 1].fill(0.0);
    sub.copy_within(1.., 0);
    sub[n - 1] = 0.0;
    ql::diagonalize(n, &mut a, &mut d, &mut sub);
    ql::sort_descending(n, &mut a, &mut d);
    let values = d[..wanted].to_vec();
    let mut vectors = vec![0f32; wanted * n];
    for i in 0..wanted {
        for j in 0..n {
            vectors[i * n + j] = a[j * n + i];
        }
    }
    Some((values, vectors))
}
