//! A chart's landmarks, their distance matrix, and the signal distance blended in.
//!
//! The landmarks: with more vertices than the minimum, a selection pass orders the vertices by
//! importance (a kept vertex first, else the one removed last), stopping once the minimum is met
//! (and more than two are chosen) where two consecutive importances differ; with fewer, every
//! vertex.
//!
//! The blend: the signal distances rescaled to the geodesic distances' mean and weighed 30%
//! against 70% of the geodesic ones, or the geodesic distances alone when the signal's mean
//! distance is under `ZERO`.
use crate::hlod::flatten::uv::spectral::mesh::{Chart, KEEP};
use crate::hlod::flatten::uv::spectral::util::ZERO;

/// The weight of the signal distance in the blend.
const SIGNAL_WEIGHT: f32 = 0.30;

impl<'a> Chart<'a> {
    /// At least `minimum` landmarks chosen and flagged; how many.
    pub(crate) fn pick_landmarks(&mut self, minimum: usize) -> usize {
        let count = self.verts.len();
        let mut order: Vec<u32> = (0..count as u32).collect();
        let importance = |chart: &Chart, v: u32| chart.verts[v as usize].importance;
        let chosen = if count > minimum {
            let mut chosen = 0;
            for i in 0..count - 1 {
                if importance(self, order[i]) != KEEP {
                    let mut best = importance(self, order[i]);
                    for j in i + 1..count {
                        let other = importance(self, order[j]);
                        if other == KEEP || best < other {
                            best = other;
                            order.swap(i, j);
                        }
                        if other == KEEP {
                            break;
                        }
                    }
                }
                chosen += 1;
                let last = importance(self, order[chosen - 1]);
                if last > 0
                    && chosen >= minimum
                    && chosen > 2
                    && last != importance(self, order[chosen - 2])
                {
                    break;
                }
            }
            chosen
        } else {
            count
        };
        for v in &mut self.verts {
            v.landmark = false;
        }
        self.landmarks = order[..chosen].to_vec();
        for &v in &self.landmarks {
            self.verts[v as usize].landmark = true;
        }
        chosen
    }

    /// The matrix of the distances `distances` (one row of every vertex per landmark of
    /// `sources`) between the chart's landmarks.
    pub(crate) fn landmark_matrix(&self, sources: &[u32], distances: &[f32]) -> Vec<f32> {
        let n = sources.len();
        let count = self.verts.len();
        let mut matrix = vec![0f32; n * n];
        for i in 0..n {
            for j in 0..n {
                matrix[i * n + j] = distances[i * count + self.landmarks[j] as usize];
            }
        }
        matrix
    }

    /// The signal distances `signal` blended with the geodesic ones `geodesic`.
    pub(super) fn blend_signal(&self, signal: &mut [f32], geodesic: &[f32]) {
        let count = signal.len();
        let mut signal_mean = 0.0f32;
        let mut geodesic_mean = 0.0f32;
        for i in 0..count {
            signal_mean += signal[i];
            geodesic_mean += geodesic[i];
        }
        signal_mean /= count as f32;
        geodesic_mean /= count as f32;
        if signal_mean > ZERO {
            let ratio = geodesic_mean / signal_mean;
            for i in 0..count {
                signal[i] = geodesic[i] * (1.0 - SIGNAL_WEIGHT) + ratio * signal[i] * SIGNAL_WEIGHT;
            }
        } else {
            signal.copy_from_slice(geodesic);
        }
    }
}
