//! The borders cut by the dihedral angle and the stretch.
//!
//! 1. Each child, in order, labels its faces, marks its fuzzy region and picks its local
//!    landmarks (`fuzzy`); their vertices here, each once in order, are all the landmarks.
//! 2. The distances from every landmark to every vertex: a landmark of this chart's own embedding
//!    keeps its row of the earlier distances, the others are measured (geodesic only); the
//!    landmarks are reordered with the kept ones first.
//! 3. Each child embeds its landmarks in two dimensions from their distances (the lesser of the
//!    two ways for each pair), their plane positions the first two coordinates.
//! 4. The cut (`distortion`), then the labels kept when they hold.
use crate::hlod::flatten::uv::spectral::mesh::Chart;

/// The dimensions each child embeds its landmarks in.
pub(super) const LANDMARK_DIMENSION: usize = 2;

impl<'a> Chart<'a> {
    /// The borders moved by the dihedral angle and the stretch, `old_geodesic` holding the
    /// distances from this chart's landmarks; whether the new labels hold.
    pub(crate) fn optimize_boundary_by_stretch(
        &mut self,
        old_geodesic: &[f32],
        face_charts: &mut [u32],
        count: usize,
    ) -> crate::Result<bool> {
        if count < 2 || self.children.len() < 2 {
            return Ok(false);
        }
        let backup = face_charts.to_vec();
        let Some((angles, mean)) = self.edge_angle_distances() else {
            return Ok(false);
        };
        let mut fuzzy = vec![false; self.faces.len()];
        let mut children = std::mem::take(&mut self.children);
        let mut landmarks = Vec::new();
        let mut levels = Vec::with_capacity(children.len());
        let mut seen = vec![false; self.verts.len()];
        for (i, child) in children.iter_mut().enumerate() {
            for face in &child.faces {
                face_charts[face.parent as usize] = i as u32;
            }
            levels.push(child.landmarks_and_fuzzy_region(self, &mut fuzzy));
            for &v in &child.landmarks {
                let parent = child.verts[v as usize].parent;
                if !seen[parent as usize] {
                    landmarks.push(parent);
                    seen[parent as usize] = true;
                }
            }
        }
        self.children = children;
        let distances = self.distances_to_landmarks(old_geodesic, &mut landmarks);
        if !self.embed_child_landmarks(&distances, &landmarks)? {
            return Ok(false);
        }
        self.cut_by_stretch(face_charts, &fuzzy, &levels, &distances, &angles, mean);
        self.keep_valid_cut(face_charts, &backup, count)
    }

    /// The distances from each of `landmarks` to every vertex, one row each, the landmarks
    /// reordered to match: first those of this chart's own landmarks (their rows of
    /// `old_geodesic`), then the others, measured.
    fn distances_to_landmarks(&mut self, old_geodesic: &[f32], landmarks: &mut [u32]) -> Vec<f32> {
        let count = self.verts.len();
        let mut distances = vec![0f32; landmarks.len() * count];
        let (mut kept, mut measured) = (Vec::new(), Vec::new());
        for &v in landmarks.iter() {
            if !self.verts[v as usize].landmark {
                measured.push(v);
                continue;
            }
            if let Some(j) = self.landmarks.iter().position(|&l| l == v) {
                let row = kept.len() * count;
                distances[row..row + count]
                    .copy_from_slice(&old_geodesic[j * count..(j + 1) * count]);
                kept.push(v);
            }
        }
        if !measured.is_empty() {
            let rows = kept.len() * count;
            self.distances_from(&measured, None, Some(&mut distances[rows..]));
        }
        for (slot, &v) in landmarks.iter_mut().zip(kept.iter().chain(&measured)) {
            *slot = v;
        }
        distances
    }

    /// Each child's landmarks embedded from `distances` (rows of `landmarks`); whether every
    /// child gave two dimensions.
    fn embed_child_landmarks(
        &mut self,
        distances: &[f32],
        landmarks: &[u32],
    ) -> crate::Result<bool> {
        for (i, &v) in landmarks.iter().enumerate() {
            self.verts[v as usize].landmark_slot = i as u32;
        }
        let count = self.verts.len();
        for child in &mut self.children {
            for &l in &child.landmarks {
                let parent = child.verts[l as usize].parent;
                child.verts[l as usize].landmark_slot = self.verts[parent as usize].landmark_slot;
            }
        }
        for child in &mut self.children {
            if child.embed_landmarks(count, distances)? != LANDMARK_DIMENSION {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// This child's landmarks embedded in two dimensions from its father's `distances` (rows of
    /// the landmark slots, `father_count` vertices each); the dimensions computed.
    fn embed_landmarks(&mut self, father_count: usize, distances: &[f32]) -> crate::Result<usize> {
        let n = self.landmarks.len();
        let mut matrix = vec![0f32; n * n];
        for j in 0..n {
            let a = &self.verts[self.landmarks[j] as usize];
            for k in j + 1..n {
                let b = &self.verts[self.landmarks[k] as usize];
                let one = distances[a.landmark_slot as usize * father_count + b.parent as usize];
                let two = distances[b.landmark_slot as usize * father_count + a.parent as usize];
                let least = if two < one { two } else { one };
                matrix[j * n + k] = least;
                matrix[k * n + j] = least;
            }
        }
        self.spectrum.init(n, matrix);
        let computed = self.spectrum.largest(LANDMARK_DIMENSION)?;
        if let Some(coords) = self.spectrum.coordinates(LANDMARK_DIMENSION) {
            for j in 0..n {
                let v = self.landmarks[j] as usize;
                self.verts[v].uv = [
                    coords[j * LANDMARK_DIMENSION],
                    coords[j * LANDMARK_DIMENSION + 1],
                ];
            }
        }
        Ok(computed)
    }
}
