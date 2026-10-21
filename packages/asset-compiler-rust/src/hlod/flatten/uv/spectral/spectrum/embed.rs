//! Every vertex placed in the spectral embedding.
//!
//! A landmark takes its coordinates from the eigenvectors scaled by the square roots of their
//! eigenvalues. Any other vertex is placed from its distances to the landmarks: the weight of
//! each landmark is its column's mean squared distance less the vertex's squared distance to it,
//! and each coordinate is the weights' dot product with that eigenvector over twice the
//! eigenvalue's square root. Every vertex takes the first two coordinates as its plane position,
//! mirrored when more faces would face down than up.
use crate::hlod::flatten::uv::spectral::fail::invalid_data;
use crate::hlod::flatten::uv::spectral::mesh::Chart;
use crate::hlod::flatten::uv::spectral::util::{cross_z, root};

impl<'a> Chart<'a> {
    /// The chart's vertices embedded in `dimension` dimensions from the landmark distances
    /// `distances` (one row of every vertex per landmark), every vertex's coordinates written to
    /// `coords` when asked.
    pub(crate) fn embed(
        &mut self,
        distances: &[f32],
        landmarks: usize,
        dimension: usize,
        mut coords: Option<&mut [f32]>,
    ) -> crate::Result<()> {
        let count = self.verts.len();
        let marks = self
            .spectrum
            .coordinates(dimension)
            .ok_or_else(|| invalid_data("more embedding dimensions than landmarks"))?;
        for i in 0..landmarks {
            let v = self.landmarks[i] as usize;
            let own = &marks[i * dimension..(i + 1) * dimension];
            if let Some(all) = coords.as_deref_mut() {
                all[v * dimension..(v + 1) * dimension].copy_from_slice(own);
            }
            self.verts[v].uv = [own[0], own[1]];
        }
        let means = self.spectrum.column_means().to_vec();
        let (values, vectors) = (
            self.spectrum.values().to_vec(),
            self.spectrum.vectors().to_vec(),
        );
        let mut weights = vec![0f32; landmarks];
        let mut scratch = vec![0f32; dimension];
        for i in 0..count {
            if self.verts[i].landmark {
                continue;
            }
            for j in 0..landmarks {
                let d = distances[j * count + i];
                weights[j] = means[j] - d * d;
            }
            let point: &mut [f32] = match coords.as_deref_mut() {
                Some(all) => &mut all[i * dimension..(i + 1) * dimension],
                None => &mut scratch,
            };
            for k in 0..dimension {
                let vector = &vectors[k * landmarks..(k + 1) * landmarks];
                let mut sum = 0.0f32;
                for j in 0..landmarks {
                    sum += weights[j] * vector[j];
                }
                point[k] = sum / (root(values[k]) * 2.0);
            }
            self.verts[i].uv = [point[0], point[1]];
        }
        let uv = |v: u32| self.verts[v as usize].uv;
        let upward = (self.faces.iter())
            .filter(|f| {
                let [a, b, c] = f.verts.map(uv);
                cross_z([b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]]) >= 0.0
            })
            .count();
        if upward < self.faces.len() - upward {
            for v in &mut self.verts {
                v.uv[1] = -v.uv[1];
            }
        }
        Ok(())
    }
}
