//! A sparse linear least-squares system in double precision, solved by the conjugate gradient
//! with a Jacobi preconditioner — the solver the conformal map stands on.
//!
//! Variables are set, some locked; the free ones are numbered in order and form the system. Each
//! row `Σ aᵢ xᵢ` adds its normal equations: `aᵢ aⱼ` to the matrix entry of every pair of free
//! variables (an entry already in its row summed in place, else appended), and `aᵢ · S` taken
//! from the right-hand side, `S` the row's sum over the locked variables at their values. The
//! solve then sorts each matrix row by column and runs the preconditioned conjugate gradient from
//! the free variables' values, until the squared residual is at most `(10⁻⁶)²` times the right-hand
//! side's squared norm or the iteration bound is reached; the free variables then take the
//! solution.
use super::mesh::NONE;

/// The relative residual the conjugate gradient stops at.
const THRESHOLD: f64 = 1e-6;

pub(super) struct LeastSquares {
    values: Vec<f64>,
    locked: Vec<bool>,
    /// Per variable, its index in the system, `NONE` when locked.
    system: Vec<usize>,
    rows: Vec<Vec<(usize, f64)>>,
    x: Vec<f64>,
    b: Vec<f64>,
    /// The current row's free and locked coefficients.
    free: Vec<(usize, f64)>,
    fixed: Vec<(usize, f64)>,
    max_iterations: usize,
}

impl LeastSquares {
    pub(super) fn new(variables: usize, max_iterations: usize) -> LeastSquares {
        LeastSquares {
            values: vec![0.0; variables],
            locked: vec![false; variables],
            system: Vec::new(),
            rows: Vec::new(),
            x: Vec::new(),
            b: Vec::new(),
            free: Vec::new(),
            fixed: Vec::new(),
            max_iterations,
        }
    }

    pub(super) fn set(&mut self, variable: usize, value: f64) {
        self.values[variable] = value;
    }

    pub(super) fn get(&self, variable: usize) -> f64 {
        self.values[variable]
    }

    pub(super) fn lock(&mut self, variable: usize) {
        self.locked[variable] = true;
    }

    /// The free variables numbered, the system sized, its unknowns started at their values.
    pub(super) fn number_unknowns(&mut self) {
        let mut n = 0;
        self.system = (self.locked.iter())
            .map(|&locked| {
                if locked {
                    NONE
                } else {
                    n += 1;
                    n - 1
                }
            })
            .collect();
        self.rows = vec![Vec::new(); n];
        self.b = vec![0.0; n];
        self.x = vec![0.0; n];
        for (variable, &index) in self.system.iter().enumerate() {
            if index != NONE {
                self.x[index] = self.values[variable];
            }
        }
    }

    pub(super) fn open_row(&mut self) {
        self.free.clear();
        self.fixed.clear();
    }

    pub(super) fn term(&mut self, variable: usize, value: f64) {
        if self.locked[variable] {
            self.fixed.push((variable, value));
        } else {
            self.free.push((self.system[variable], value));
        }
    }

    pub(super) fn close_row(&mut self) {
        for i in 0..self.free.len() {
            for j in 0..self.free.len() {
                let ((row, a), (column, b)) = (self.free[i], self.free[j]);
                self.add(row, column, a * b);
            }
        }
        let mut sum = 0.0;
        for &(variable, value) in &self.fixed {
            sum += value * self.values[variable];
        }
        for &(index, value) in &self.free {
            self.b[index] -= value * sum;
        }
    }

    fn add(&mut self, row: usize, column: usize, value: f64) {
        let entries = &mut self.rows[row];
        match entries.iter_mut().find(|(at, _)| *at == column) {
            Some((_, sum)) => *sum += value,
            None => entries.push((column, value)),
        }
    }

    pub(super) fn solve(&mut self) {
        for row in self.rows.iter_mut() {
            row.sort_by_key(|&(column, _)| column);
        }
        // The Jacobi preconditioner: each row's diagonal entry inverted, one where it is zero
        // (a sum that only differs from it by the sign of a zero).
        let inverse: Vec<f64> = (self.rows.iter().enumerate())
            .map(|(i, row)| {
                let at = row.binary_search_by_key(&i, |&(column, _)| column);
                let d = at.map_or(0.0, |at| row[at].1);
                if d == 0.0 {
                    1.0
                } else {
                    1.0 / d
                }
            })
            .collect();
        self.conjugate_gradient(&inverse);
        for (variable, &index) in self.system.iter().enumerate() {
            if index != NONE {
                self.values[variable] = self.x[index];
            }
        }
    }

    /// `out = M v`, each row summed in column order.
    fn multiply(&self, v: &[f64], out: &mut [f64]) {
        for (row, value) in self.rows.iter().zip(out.iter_mut()) {
            let mut sum = 0.0;
            for &(column, entry) in row {
                sum += entry * v[column];
            }
            *value = sum;
        }
    }

    fn conjugate_gradient(&mut self, inverse: &[f64]) {
        let n = self.x.len();
        let precondition = |v: &[f64], out: &mut [f64]| {
            for ((slot, &value), &factor) in out.iter_mut().zip(v).zip(inverse) {
                *slot = value * factor;
            }
        };
        let (mut r, mut d, mut h) = (vec![0.0; n], vec![0.0; n], vec![0.0; n]);
        let b_square = dot(&self.b, &self.b);
        let bound = THRESHOLD * THRESHOLD * b_square;
        self.multiply(&self.x, &mut r);
        axpy(-1.0, &self.b, &mut r);
        precondition(&r, &mut d);
        h.copy_from_slice(&d);
        let mut rh = dot(&r, &h);
        let mut error = dot(&r, &r);
        let mut iterations = 0;
        while error > bound && iterations < self.max_iterations {
            self.multiply(&d, &mut h);
            let alpha = rh / dot(&d, &h);
            axpy(-alpha, &d, &mut self.x);
            axpy(-alpha, &h, &mut r);
            precondition(&r, &mut h);
            let mut beta = 1.0 / rh;
            rh = dot(&r, &h);
            beta *= rh;
            for value in d.iter_mut() {
                *value *= beta;
            }
            axpy(1.0, &h, &mut d);
            iterations += 1;
            error = dot(&r, &r);
        }
    }
}

/// `Σ xᵢ yᵢ` in index order from zero.
fn dot(x: &[f64], y: &[f64]) -> f64 {
    x.iter().zip(y).fold(0.0, |sum, (a, b)| sum + a * b)
}

/// `y ← a x + y`.
fn axpy(a: f64, x: &[f64], y: &mut [f64]) {
    for (y, &x) in y.iter_mut().zip(x) {
        *y += a * x;
    }
}
