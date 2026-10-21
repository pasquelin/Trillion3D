//! A sparse linear system in double precision, solved by conjugate gradients.
//!
//! A row keeps its entries in the order their columns first appeared (setting an entry replaces
//! it, adding to one sums into it); every product walks the rows in order and each row's entries
//! in order, so the sums round as they always do. `normal` forms `AᵀA` by adding, for each row,
//! the product of every pair of its entries; `transposed_product` forms `Aᵀb`.
//!
//! The gradients start from zero and stop once the squared residual falls to `ε²` times its
//! starting value or the iterations run out; every tenth iteration recomputes the residual from
//! the system instead of updating it.

/// A sparse matrix of `columns` columns, row by row.
pub(super) struct Sparse {
    rows: Vec<Vec<(usize, f64)>>,
    columns: usize,
}

impl Sparse {
    pub(super) fn new(rows: usize, columns: usize) -> Sparse {
        Sparse {
            rows: vec![Vec::new(); rows],
            columns,
        }
    }

    /// Entry (`row`, `column`) set to `value`.
    pub(super) fn set(&mut self, row: usize, column: usize, value: f64) {
        let entries = &mut self.rows[row];
        match entries.iter_mut().find(|(c, _)| *c == column) {
            Some(entry) => entry.1 = value,
            None => entries.push((column, value)),
        }
    }

    /// `delta` added to entry (`row`, `column`).
    fn add(&mut self, row: usize, column: usize, delta: f64) {
        let entries = &mut self.rows[row];
        match entries.iter_mut().find(|(c, _)| *c == column) {
            Some(entry) => entry.1 += delta,
            None => entries.push((column, delta)),
        }
    }

    /// `AᵀA`.
    pub(super) fn normal(&self) -> Sparse {
        let mut product = Sparse::new(self.columns, self.columns);
        for row in &self.rows {
            for &(i, a) in row {
                for &(j, b) in row {
                    product.add(i, j, a * b);
                }
            }
        }
        product
    }

    /// `A x`.
    fn product(&self, x: &[f64]) -> Vec<f64> {
        (self.rows.iter())
            .map(|row| row.iter().fold(0.0, |sum, &(c, v)| sum + v * x[c]))
            .collect()
    }

    /// `Aᵀ b`.
    pub(super) fn transposed_product(&self, b: &[f64]) -> Vec<f64> {
        let mut out = vec![0.0; self.columns];
        for (row, &bi) in self.rows.iter().zip(b) {
            for &(c, v) in row {
                out[c] += v * bi;
            }
        }
        out
    }

    /// The solution of `A x = b` from zero by conjugate gradients, at most `limit` iterations for
    /// the relative tolerance `epsilon`; the iterations run.
    pub(super) fn conjugate_gradient(
        &self,
        b: &[f64],
        limit: usize,
        epsilon: f64,
    ) -> (Vec<f64>, usize) {
        let mut x = vec![0.0; self.columns];
        let mut r = residual(b, &self.product(&x));
        let mut d = r.clone();
        let mut delta_new = dot(&r, &r);
        let bound = delta_new * epsilon * epsilon;
        let mut iterations = 0;
        while iterations < limit && delta_new > bound {
            let q = self.product(&d);
            let a = delta_new / dot(&d, &q);
            for (xi, &di) in x.iter_mut().zip(&d) {
                *xi += di * a;
            }
            if iterations % 10 == 0 {
                r = residual(b, &self.product(&x));
            } else {
                for (ri, &qi) in r.iter_mut().zip(&q) {
                    *ri -= qi * a;
                }
            }
            let delta_old = delta_new;
            delta_new = dot(&r, &r);
            let beta = delta_new / delta_old;
            for (di, &ri) in d.iter_mut().zip(&r) {
                *di = ri + *di * beta;
            }
            iterations += 1;
        }
        (x, iterations)
    }
}

/// `b − a`.
fn residual(b: &[f64], a: &[f64]) -> Vec<f64> {
    b.iter().zip(a).map(|(x, y)| x - y).collect()
}

/// The dot product, summed in order from zero.
fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).fold(0.0, |sum, (x, y)| sum + x * y)
}
