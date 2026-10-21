//! A joined chart's first parameterisation.
//!
//! Its edges measured, it is embedded by its spectrum when not yet parameterised: its landmarks
//! chosen (at least 25 when it has them), their geodesic distances measured, the two largest
//! eigenpairs of their distance matrix computed and every vertex placed in those two dimensions;
//! the landmarks and the spectrum are then dropped. The embedding holds when its boundary does not
//! cross itself and its stretch can be made finite; else, when the stretch bound is loose enough
//! (at least the bound of 0.95), the barycentric layout holds when it does not overlap.
use crate::hlod::flatten::uv::spectral::criteria::{internal_criterion, BARYCENTRIC_STRETCH};
use crate::hlod::flatten::uv::spectral::mesh::{Chart, MIN_LANDMARKS};

/// The dimensions a joined chart is embedded in.
const JOINED_DIMENSION: usize = 2;

impl<'a> Chart<'a> {
    /// The chart parameterised; whether a parameterisation holds.
    pub(super) fn try_parameterize(&mut self) -> crate::Result<bool> {
        self.measure_edges();
        self.embed_joined()?;
        if !self.overlaps() && self.optimize_infinite_stretch() {
            return Ok(true);
        }
        if self.source.expected_l2.get() >= internal_criterion(BARYCENTRIC_STRETCH, false) {
            return Ok(!self.barycentric());
        }
        Ok(false)
    }

    /// The chart embedded in two dimensions by its spectrum, unless already parameterised.
    fn embed_joined(&mut self) -> crate::Result<()> {
        if self.parameterized {
            return Ok(());
        }
        let count = self.pick_landmarks(MIN_LANDMARKS);
        let mut geodesic = vec![0f32; count * self.verts.len()];
        let marks = self.landmarks.clone();
        self.distances_from(&marks, None, Some(&mut geodesic));
        let matrix = self.landmark_matrix(&marks, &geodesic);
        self.spectrum.init(count, matrix);
        let outcome = self
            .spectrum
            .largest(JOINED_DIMENSION)
            .and_then(|_| self.embed(&geodesic, count, JOINED_DIMENSION, None));
        if outcome.is_ok() {
            self.parameterized = true;
        }
        self.landmarks.clear();
        self.spectrum.clear();
        outcome
    }
}
