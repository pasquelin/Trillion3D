//! A chart of no particular shape: kept as embedded, laid flat, or clustered.
//!
//! 1. With one boundary and fewer than 4 primary dimensions, an embedding whose boundary does not
//!    cross itself is kept when its stretch can be made finite; its two landmarks farthest apart
//!    on the surface then lead the landmark list.
//! 2. With one boundary and a loose stretch bound (at least the bound of 0.95), the barycentric
//!    layout is kept when it does not overlap.
//! 3. The representatives: per primary dimension in order, the landmarks of largest and least
//!    coordinate, each kept once. A sub-chart keeps the first two (missing ones read landmark 0);
//!    any other chart keeps the first two, then repeatedly the one farthest (by its distance to
//!    the nearest kept) from those kept, while that distance reaches the chart's mean radius,
//!    `√(area / (dimensions + 1))`.
//! 4. Each face joins the representative of least summed distance from its corners (the first
//!    among equals); the labels are smoothed and made valid, built into children, their border
//!    moved by a graph cut — on the dihedral angle, or for a sub-chart on the stretch — and built
//!    again. When fewer than two children result, each face becomes a child.
use crate::hlod::flatten::uv::spectral::criteria::{internal_criterion, BARYCENTRIC_STRETCH};
use crate::hlod::flatten::uv::spectral::mesh::{Chart, NONE};
use crate::hlod::flatten::uv::spectral::partition::Embedding;
use crate::hlod::flatten::uv::spectral::util::{move_two_to_front, push_unique, root};

/// Below this many primary dimensions, an embedding of one boundary may be kept as it is.
const KEPT_DIMENSIONS: usize = 4;

impl<'a> Chart<'a> {
    /// The chart kept, laid flat or clustered into children.
    pub(crate) fn process_general(
        &mut self,
        boundaries: usize,
        embedding: &Embedding,
    ) -> crate::Result<()> {
        if boundaries == 1
            && embedding.primary < KEPT_DIMENSIONS
            && !self.overlaps()
            && self.optimize_infinite_stretch()
        {
            self.lead_with_farthest_landmarks(&embedding.geodesic);
            return Ok(());
        }
        let loose = internal_criterion(BARYCENTRIC_STRETCH, false);
        if boundaries == 1 && self.source.expected_l2.get() >= loose && !self.barycentric() {
            return Ok(());
        }
        let mut representatives = self.representatives(embedding.primary, &embedding.coords);
        if self.sub_chart {
            representatives.resize(2, 0);
        } else {
            self.drop_close_representatives(
                &mut representatives,
                embedding.primary,
                &embedding.geodesic,
            );
        }
        let split = self.partition_general(
            &embedding.geodesic,
            embedding.combined(),
            &representatives,
            false,
        )?;
        if split && self.children.len() > 1 {
            return Ok(());
        }
        self.partition_each_face()
    }

    /// The landmarks of largest and least coordinate along each of the first `dimension`
    /// embedding dimensions, as places in the landmark list.
    fn representatives(&self, dimension: usize, coords: &[f32]) -> Vec<u32> {
        let mut found = Vec::new();
        for axis in 0..dimension {
            let (mut largest, mut least) = (-f32::MAX, f32::MAX);
            let (mut high, mut low) = (NONE, NONE);
            for (i, &v) in self.landmarks.iter().enumerate() {
                let c = coords[dimension * v as usize + axis];
                if c > largest {
                    high = i as u32;
                    largest = c;
                }
                if c < least {
                    low = i as u32;
                    least = c;
                }
            }
            if high == NONE || low == NONE {
                continue;
            }
            push_unique(&mut found, high);
            push_unique(&mut found, low);
        }
        found
    }

    /// The representatives past the first two kept, farthest first, while they lie at least the
    /// chart's mean radius from those kept; at least two places remain.
    fn drop_close_representatives(
        &self,
        representatives: &mut Vec<u32>,
        dimension: usize,
        geodesic: &[f32],
    ) {
        let radius = root(self.area_3d / (dimension + 1) as f32);
        let count = self.verts.len();
        let mut i = 2;
        while i < representatives.len() {
            let mut farthest = 0.0;
            let mut chosen = NONE;
            for j in i..representatives.len() {
                let target = self.landmarks[representatives[j] as usize] as usize;
                let mut nearest = f32::MAX;
                for &kept in &representatives[..i] {
                    let d = geodesic[kept as usize * count + target];
                    if d < nearest {
                        nearest = d;
                    }
                }
                if nearest > farthest {
                    farthest = nearest;
                    chosen = j as u32;
                }
            }
            if farthest < radius || chosen == NONE {
                break;
            }
            representatives.swap(i, chosen as usize);
            i += 1;
        }
        representatives.resize(i, 0);
    }

    /// The two landmarks farthest apart on the surface moved to the front of the landmark list,
    /// which is then ordered.
    fn lead_with_farthest_landmarks(&mut self, geodesic: &[f32]) {
        self.landmarks_ordered = true;
        let marks = self.landmarks.len();
        if marks < 3 {
            return;
        }
        let count = self.verts.len();
        let mut farthest = -f32::MAX;
        let mut pair = (0, 0);
        for i in 0..marks - 1 {
            for j in i + 1..marks {
                let d = geodesic[i * count + self.landmarks[j] as usize];
                if d > farthest {
                    farthest = d;
                    pair = (i, j);
                }
            }
        }
        move_two_to_front(&mut self.landmarks, pair.0, pair.1);
    }

    /// The chart clustered around `representatives` (rows of `combined`) into children, their
    /// border moved on the dihedral angle when `by_angle` or the chart is no sub-chart, else on
    /// the stretch; whether children were made.
    pub(crate) fn partition_general(
        &mut self,
        geodesic: &[f32],
        combined: &[f32],
        representatives: &[u32],
        by_angle: bool,
    ) -> crate::Result<bool> {
        if representatives.len() < 2 {
            return Ok(false);
        }
        let mut face_charts = self.cluster_faces(combined, representatives);
        let count = representatives.len();
        if !self.smooth_partition(count, &mut face_charts)?
            || !self.build_sub_charts(&face_charts, count)?
        {
            return Ok(false);
        }
        let optimized = if !self.sub_chart || by_angle {
            self.optimize_boundary_by_angle(&mut face_charts, count)?
                .unwrap_or(false)
        } else {
            self.optimize_boundary_by_stretch(geodesic, &mut face_charts, count)?
        };
        if !optimized {
            return Ok(true);
        }
        self.build_sub_charts(&face_charts, count)
    }

    /// Each face's label: the representative (a row of `distances`) of least summed distance
    /// from its corners, the first among equals.
    pub(super) fn cluster_faces(&self, distances: &[f32], representatives: &[u32]) -> Vec<u32> {
        let count = self.verts.len();
        let mut face_charts = vec![NONE; self.faces.len()];
        for (f, face) in self.faces.iter().enumerate() {
            let mut least = f32::MAX;
            for (j, &r) in representatives.iter().enumerate() {
                let row = &distances[count * r as usize..];
                let d = row[face.verts[0] as usize]
                    + row[face.verts[1] as usize]
                    + row[face.verts[2] as usize];
                if d < least {
                    face_charts[f] = j as u32;
                    least = d;
                }
            }
        }
        face_charts
    }

    /// Every face made a child of its own.
    pub(crate) fn partition_each_face(&mut self) -> crate::Result<()> {
        if self.faces.is_empty() {
            return Ok(());
        }
        self.children.clear();
        for f in 0..self.faces.len() as u32 {
            self.build_sub_chart(&[f])?;
        }
        Ok(())
    }
}
