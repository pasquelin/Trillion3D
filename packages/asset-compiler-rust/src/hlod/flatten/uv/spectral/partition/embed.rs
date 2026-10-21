//! A simple chart's spectral embedding, as the partition reads it.
//!
//! The landmarks are chosen and measured; their distance matrix gives the largest eigenpairs (at
//! most 10 for a chart never cut, 4 for a sub-chart); the primary dimensions keep 90% of the
//! energy. A chart of no primary dimension has degenerated to a point; a plane-like chart is
//! parameterised by its first two dimensions there (`shape`); any other is embedded in its primary
//! dimensions, at least 3 when 3 were computed, so its shape can be recognised.
use crate::hlod::flatten::uv::spectral::mesh::{Chart, FIRST_EIGEN_DIMENSION, MIN_LANDMARKS};

/// The spectrum's dimensions computed for a sub-chart.
const SUB_CHART_EIGEN_DIMENSION: usize = 4;
/// The share of the spectrum's energy the primary dimensions carry.
const PRIMARY_ENERGY: f32 = 0.90;
/// The dimensions a shape test needs.
const SHAPE_DIMENSION: usize = 3;

/// What the embedding found: whether the chart was taken as plane-like, its primary and computed
/// dimensions, the landmarks' distances to every vertex (geodesic, and blended with the signal
/// when one is given) and every vertex's coordinates in the primary dimensions.
pub(crate) struct Embedding {
    pub like_plane: bool,
    pub primary: usize,
    pub computed: usize,
    pub geodesic: Vec<f32>,
    pub blended: Option<Vec<f32>>,
    pub coords: Vec<f32>,
}

impl Embedding {
    /// The distances the partition clusters by: blended with the signal when one is given.
    pub(crate) fn combined(&self) -> &[f32] {
        self.blended.as_deref().unwrap_or(&self.geodesic)
    }
}

impl<'a> Chart<'a> {
    /// The chart's embedding.
    pub(crate) fn spectral_embedding(&mut self) -> crate::Result<Embedding> {
        let landmark_count = self.pick_landmarks(MIN_LANDMARKS);
        let count = self.verts.len();
        let mut geodesic = vec![0f32; landmark_count * count];
        let mut blended = self
            .has_signal()
            .then(|| vec![0f32; landmark_count * count]);
        let marks = self.landmarks.clone();
        self.distances_from(&marks, blended.as_deref_mut(), Some(&mut geodesic));
        let matrix = self.landmark_matrix(&marks, &geodesic);
        let limit = if self.sub_chart {
            SUB_CHART_EIGEN_DIMENSION
        } else {
            FIRST_EIGEN_DIMENSION
        };
        let wanted = limit.min(landmark_count);
        self.spectrum.init(landmark_count, matrix);
        let computed = self.spectrum.largest(wanted)?;
        let mut embedding = Embedding {
            like_plane: false,
            primary: self.spectrum.primary_dimension(PRIMARY_ENERGY),
            computed,
            geodesic,
            blended,
            coords: Vec::new(),
        };
        if embedding.primary == 0 {
            return Ok(embedding);
        }
        if self.process_plane_like(computed, embedding.primary)? {
            embedding.like_plane = true;
            return Ok(embedding);
        }
        if embedding.primary < SHAPE_DIMENSION && computed >= SHAPE_DIMENSION {
            embedding.primary = SHAPE_DIMENSION;
        }
        let mut coords = vec![0f32; count * embedding.primary];
        self.embed(
            &embedding.geodesic,
            landmark_count,
            embedding.primary,
            Some(&mut coords),
        )?;
        embedding.coords = coords;
        self.parameterized = true;
        Ok(embedding)
    }
}
