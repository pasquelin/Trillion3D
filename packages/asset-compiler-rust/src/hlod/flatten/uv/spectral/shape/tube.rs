//! A cylinder or a horn cut in two.
//!
//! A cylinder: each face is labelled by the sign of the sum of its corners' third embedding
//! coordinate (the shorter cross-section axis; zero counts as positive); when one side is empty or
//! more than twice the other in whole faces, by the second instead. The labels are smoothed and
//! made valid. A horn: the faces around the extreme vertex against all others, made valid. Either
//! is built into two children, their border moved by a graph cut on the stretch, then built
//! again; when the cut moves nothing, the first children stay.
use crate::hlod::flatten::uv::spectral::mesh::Chart;

/// The parts a cylinder or a horn is cut into.
const PARTS: usize = 2;

impl<'a> Chart<'a> {
    /// The cylinder cut across by its embedding `coords` of `dimension` coordinates a vertex;
    /// whether it was.
    pub(super) fn cut_cylinder(
        &mut self,
        geodesic: &[f32],
        coords: &[f32],
        dimension: usize,
    ) -> crate::Result<bool> {
        let mut face_charts = vec![0u32; self.faces.len()];
        let (mut positive, mut negative) =
            self.label_by_sign(coords, dimension, 2, &mut face_charts);
        if positive == 0 || negative == 0 || positive / negative > 2 || negative / positive > 2 {
            (positive, negative) = self.label_by_sign(coords, dimension, 1, &mut face_charts);
        }
        if positive == 0 || negative == 0 {
            return Ok(false);
        }
        if !self.smooth_partition(PARTS, &mut face_charts)? {
            return Ok(false);
        }
        self.halves_by_stretch(geodesic, &mut face_charts)
    }

    /// Each face labelled 0 when the sum of its corners' coordinate `axis` is negative, else 1;
    /// the positive and negative face counts.
    fn label_by_sign(
        &self,
        coords: &[f32],
        dimension: usize,
        axis: usize,
        face_charts: &mut [u32],
    ) -> (usize, usize) {
        let (mut positive, mut negative) = (0, 0);
        for (f, face) in self.faces.iter().enumerate() {
            let mut sum = 0.0f32;
            for v in face.verts {
                sum += coords[v as usize * dimension + axis];
            }
            if sum < 0.0 {
                face_charts[f] = 0;
                negative += 1;
            } else {
                face_charts[f] = 1;
                positive += 1;
            }
        }
        (positive, negative)
    }

    /// The horn cut around its extreme vertex `extreme`; whether it was.
    pub(super) fn cut_horn(&mut self, geodesic: &[f32], extreme: u32) -> crate::Result<bool> {
        let mut face_charts = vec![1u32; self.faces.len()];
        for &f in &self.verts[extreme as usize].faces {
            face_charts[f as usize] = 0;
        }
        if !self.make_partition_valid(PARTS, &mut face_charts)? {
            return Ok(false);
        }
        self.halves_by_stretch(geodesic, &mut face_charts)
    }

    /// The two children of the labels `face_charts`, their border moved by the stretch, built
    /// again; whether children were made.
    fn halves_by_stretch(
        &mut self,
        geodesic: &[f32],
        face_charts: &mut [u32],
    ) -> crate::Result<bool> {
        if !self.build_sub_charts(face_charts, PARTS)? {
            return Ok(false);
        }
        if !self.optimize_boundary_by_stretch(geodesic, face_charts, PARTS)? {
            return Ok(true);
        }
        self.build_sub_charts(face_charts, PARTS)
    }
}
