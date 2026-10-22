//! A chart's spectral embedding: landmark multidimensional scaling of its geodesic distances.
//!
//! 1. Landmarks (`landmarks`): the vertices the simplification removes last, at least 25.
//! 2. Distances (`distance`): from each landmark to every vertex, along edges with each triangle's
//!    straight crossing allowed, then (on small enough meshes without a signal) the window
//!    propagation's exact surface distance where it is shorter; with a signal, the signal distance
//!    blended in.
//! 3. The landmarks' matrix of squared distances, double-centred and halved (`Spectrum::init`):
//!    its largest eigenvalues and eigenvectors (`eigen`, Householder reduction to tridiagonal form
//!    and shifted QL iterations) give the landmarks' coordinates, every other vertex placed from
//!    its distances to the landmarks (`embed`), the plane turned so most faces face up.
//!
//! A spectrum keeps the eigenvalues, the eigenvectors (each contiguous), and the mean of each
//! column of squared distances.
use super::fail::failed;
use super::util::{near_zero, root, root64, ZERO};

mod distance;
mod eigen;
mod embed;
mod landmarks;

#[derive(Default)]
pub(crate) struct Spectrum {
    dimension: usize,
    calculated: usize,
    matrix: Vec<f32>,
    values: Vec<f32>,
    vectors: Vec<f32>,
    column_means: Vec<f32>,
    energy: f32,
}

impl Spectrum {
    /// The spectrum emptied.
    pub(crate) fn clear(&mut self) {
        *self = Spectrum::default();
    }

    /// The double-centred matrix of the squared distances `matrix`, `dimension` landmarks a side.
    pub(crate) fn init(&mut self, dimension: usize, mut matrix: Vec<f32>) {
        self.clear();
        self.dimension = dimension;
        for v in matrix.iter_mut() {
            *v *= *v;
        }
        let n = dimension;
        let mut mean = vec![0f32; n];
        for (i, m) in mean.iter_mut().enumerate() {
            for j in 0..n {
                *m += matrix[j * n + i];
            }
            *m /= n as f32;
        }
        self.column_means = mean.clone();
        for row in matrix.chunks_exact_mut(n) {
            for (j, v) in row.iter_mut().enumerate() {
                *v -= mean[j];
            }
        }
        for (i, row) in matrix.chunks_exact(n).enumerate() {
            mean[i] = row.iter().fold(0.0, |sum, &v| sum + v) / n as f32;
        }
        for (i, row) in matrix.chunks_exact_mut(n).enumerate() {
            for v in row.iter_mut() {
                *v -= mean[i];
            }
        }
        for v in matrix.iter_mut() {
            *v *= -0.5;
        }
        self.matrix = matrix;
    }

    /// The `wanted` largest eigenvalues and their vectors; how many are positive and not
    /// negligible against the one before.
    pub(crate) fn largest(&mut self, wanted: usize) -> crate::Result<usize> {
        let (values, vectors) = eigen::largest(self.dimension, &self.matrix, wanted)
            .ok_or_else(|| failed("no eigenvalue to compute"))?;
        self.values = values;
        self.vectors = vectors;
        self.energy = 0.0;
        let mut calculated = 0;
        for i in 0..wanted {
            let v = self.values[i];
            if v < ZERO || (i > 0 && v < self.values[i - 1] * ZERO && v != 0.0) {
                break;
            }
            self.energy += v;
            calculated += 1;
        }
        if wanted == 2 {
            calculated = 2;
        }
        self.calculated = calculated;
        Ok(calculated)
    }

    /// How many dimensions carry `share` of the energy, read where the square roots of
    /// successive eigenvalues drop most below 91%; at least 2, 0 for no energy.
    pub(crate) fn primary_dimension(&self, share: f32) -> usize {
        if near_zero(self.energy) {
            return 0;
        }
        let value = |i: usize| self.values.get(i).copied().unwrap_or(0.0);
        let mut destine = 2;
        let mut precision = value(0) + value(1);
        while (precision as f64) < 0.99 * self.energy as f64 && destine < self.calculated {
            precision += value(destine);
            destine += 1;
        }
        let drops: Vec<f32> = (0..destine - 1)
            .map(|i| root(value(i)) - root(value(i + 1)))
            .collect();
        let mut accumulate = 2;
        precision = value(0) + value(1);
        while precision < self.energy * share && accumulate < destine {
            precision += value(accumulate);
            accumulate += 1;
        }
        if share as f64 >= 0.91 {
            return accumulate.max(2);
        }
        let mut required = 0;
        let mut largest_drop = 0.0;
        for (i, &fall) in drops
            .iter()
            .enumerate()
            .take(destine - 1)
            .skip(accumulate - 1)
        {
            if i == accumulate - 1 || largest_drop < fall {
                required = i;
                largest_drop = fall;
            }
        }
        if required == 0 {
            2
        } else {
            required + 1
        }
    }

    /// The landmarks' coordinates in the first `dimension` eigen directions, landmark by
    /// landmark; the negative eigenvalues among them clamped to zero. `None` when more
    /// dimensions are asked than there are landmarks.
    pub(crate) fn coordinates(&mut self, dimension: usize) -> Option<Vec<f32>> {
        if dimension > self.dimension {
            return None;
        }
        let n = self.dimension;
        let mut coords = vec![0f32; n * dimension];
        for i in 0..dimension {
            if self.values[i] < 0.0 {
                self.values[i] = 0.0;
            }
            let scale = root64(self.values[i] as f64) as f32;
            for j in 0..n {
                coords[j * dimension + i] = scale * self.vectors[i * n + j];
            }
        }
        Some(coords)
    }

    pub(crate) fn values(&self) -> &[f32] {
        &self.values
    }

    pub(crate) fn vectors(&self) -> &[f32] {
        &self.vectors
    }

    pub(crate) fn column_means(&self) -> &[f32] {
        &self.column_means
    }

    pub(crate) fn calculated(&self) -> usize {
        self.calculated
    }
}
