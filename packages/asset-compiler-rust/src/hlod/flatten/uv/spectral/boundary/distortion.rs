//! The borders cut by the dihedral angle and the distortion of the children's embeddings.
//!
//! Once: each child's neighbours are found, then every pair of neighbouring children of which
//! at least one has a fuzzy level of 1 or more is cut. A face's distortion in a child: its
//! corners are placed in the child's landmark embedding from their distances to the child's
//! landmarks (each landmark weighed by its column's mean squared distance less the corner's
//! squared distance, projected on each eigenvector over twice its eigenvalue's square root), the
//! face at their mean; the distortion is the mean, over the child's landmarks, of the squared
//! difference between the plane distance from the face to the landmark and the face's mean
//! distance to it along the surface. A link weighs `0.65 / (1 + d / mean d)` plus `0.35` times the
//! two faces' differences of distortion between the children over twice their mean.
use super::stretch::LANDMARK_DIMENSION;
use crate::hlod::flatten::uv::spectral::mesh::Chart;
use crate::hlod::flatten::uv::spectral::util::root64;

/// The share of the stretch in a link's weight, the angle taking the rest.
const STRETCH_WEIGHT: f32 = 0.35;

impl<'a> Chart<'a> {
    /// The fuzzy faces `fuzzy` relabelled along the borders of children of fuzzy level `levels`,
    /// by the dihedral angles `angles` of mean `mean` and the distortion read from `distances`.
    pub(super) fn cut_by_stretch(
        &mut self,
        face_charts: &mut [u32],
        fuzzy: &[bool],
        levels: &[u32],
        distances: &[f32],
        angles: &[f32],
        mean: f32,
    ) {
        self.find_neighbour_children(face_charts);
        let used =
            |&(one, two): &(u32, u32)| levels[one as usize] >= 1 || levels[two as usize] >= 1;
        for border in self.borders().filter(used) {
            let (one, two) = border;
            let Some(nodes) = self.border_nodes(border, face_charts, fuzzy) else {
                continue;
            };
            let mut differences = vec![0f32; self.faces.len()];
            let mut sum = 0.0f32;
            for &f in &nodes.faces {
                let first = self.face_distortion(f, one, distances);
                let second = self.face_distortion(f, two, distances);
                differences[f as usize] = (first - second).abs();
                sum += differences[f as usize];
            }
            let mean_difference = 2.0 * sum / nodes.faces.len() as f32;
            self.cut_nodes(border, &nodes, face_charts, fuzzy, |edge, f, across| {
                let angle = (1.0 - STRETCH_WEIGHT) / (1.0 + angles[edge.id as usize] / mean);
                angle
                    + (differences[f as usize] + differences[across as usize]) / mean_difference
                        * STRETCH_WEIGHT
            });
        }
    }

    /// Vertex `v` placed in child `child`'s landmark embedding.
    fn place_in_child(&self, v: u32, child: u32, distances: &[f32]) -> [f32; LANDMARK_DIMENSION] {
        let child = &self.children[child as usize];
        let means = child.spectrum.column_means();
        let count = self.verts.len();
        let weights: Vec<f32> = (child.landmarks.iter().enumerate())
            .map(|(i, &l)| {
                let d =
                    distances[child.verts[l as usize].landmark_slot as usize * count + v as usize];
                means[i] - d * d
            })
            .collect();
        let (values, vectors) = (child.spectrum.values(), child.spectrum.vectors());
        let n = child.landmarks.len();
        let mut coord = [0f32; LANDMARK_DIMENSION];
        for (k, c) in coord.iter_mut().enumerate() {
            for (i, &w) in weights.iter().enumerate() {
                *c += w * vectors[k * n + i];
            }
            *c /= (root64(values[k] as f64) * 2.0) as f32;
        }
        coord
    }

    /// The distortion of face `f` in child `child`'s landmark embedding.
    fn face_distortion(&self, f: u32, child: u32, distances: &[f32]) -> f32 {
        let corners = self.faces[f as usize].verts;
        let mut center = [0f32; LANDMARK_DIMENSION];
        for &v in &corners {
            let coord = self.place_in_child(v, child, distances);
            for (c, x) in center.iter_mut().zip(coord) {
                *c += x;
            }
        }
        for c in &mut center {
            *c /= 3.0;
        }
        let child = &self.children[child as usize];
        let count = self.verts.len();
        let mut error = 0.0f32;
        for &l in &child.landmarks {
            let landmark = &child.verts[l as usize];
            let (dx, dy) = (center[0] - landmark.uv[0], center[1] - landmark.uv[1]);
            let plane = root64((dx * dx + dy * dy) as f64) as f32;
            let row = landmark.landmark_slot as usize * count;
            let mut surface = 0.0f32;
            for &v in &corners {
                surface += distances[row + v as usize];
            }
            surface /= 3.0;
            let gap = plane - surface;
            error += gap * gap;
        }
        error / child.landmarks.len() as f32
    }
}
