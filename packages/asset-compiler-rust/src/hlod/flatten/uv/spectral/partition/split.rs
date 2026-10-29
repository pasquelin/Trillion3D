//! A parameterised chart split in two.
//!
//! On the surface: the two landmarks farthest apart in the plane (the two farthest vertices when
//! the chart has fewer than two landmarks) are moved to the front of the landmark list; the
//! chart's faces are clustered around them by surface distance, their border optimised by the
//! dihedral angle. When that gives no two children, the two vertices farthest apart in the plane
//! split the chart by plane distance; when that fails too, each face becomes a chart.
use crate::hlod::flatten::uv::spectral::mesh::{Chart, NONE};
use crate::hlod::flatten::uv::spectral::util::move_two_to_front;
use rayon::prelude::*;

/// The two of `ids` farthest apart in the chart's plane, as positions in `ids`: the first pair,
/// in order, of the greatest squared distance. Each row of pairs gives its first greatest on its
/// own thread, and the rows are then taken in order, a strictly greater one replacing the last.
fn farthest_pair(chart: &Chart, ids: &[u32]) -> (u32, u32) {
    let uvs: Vec<[f32; 2]> = ids.iter().map(|&v| chart.verts[v as usize].uv).collect();
    let rows: Vec<Option<(f32, u32)>> = (0..uvs.len().saturating_sub(1))
        .into_par_iter()
        .map(|i| {
            let a = uvs[i];
            let mut best = None;
            let mut largest = -f32::MAX;
            for (j, &b) in uvs.iter().enumerate().skip(i + 1) {
                let (dx, dy) = (a[0] - b[0], a[1] - b[1]);
                let d = dx * dx + dy * dy;
                if largest < d {
                    largest = d;
                    best = Some((d, j as u32));
                }
            }
            best
        })
        .collect();
    let mut largest = -f32::MAX;
    let (mut first, mut second) = (NONE, NONE);
    for (i, row) in rows.into_iter().enumerate() {
        if let Some((d, j)) = row {
            if largest < d {
                largest = d;
                (first, second) = (i as u32, j);
            }
        }
    }
    (first, second)
}

impl<'a> Chart<'a> {
    /// The two landmarks farthest apart in the plane first in the landmark list.
    fn order_split_landmarks(&mut self) {
        if self.landmarks_ordered {
            return;
        }
        if self.landmarks.len() < 2 {
            let all: Vec<u32> = (0..self.verts.len() as u32).collect();
            let (a, b) = farthest_pair(self, &all);
            self.landmarks.push(a);
            self.landmarks.push(b);
        } else {
            let (a, b) = farthest_pair(self, &self.landmarks);
            move_two_to_front(&mut self.landmarks, a as usize, b as usize);
        }
    }

    /// The distances of every vertex from the two `sources` (two floats per vertex): along the
    /// surface, and, when the chart has a signal, blended with it.
    fn distances_from_two(&mut self, sources: &[u32]) -> (Vec<f32>, Option<Vec<f32>>) {
        let count = self.verts.len();
        let mut geodesic = vec![0f32; 2 * count];
        let mut blended = self.has_signal().then(|| vec![0f32; 2 * count]);
        self.distances_from(sources, blended.as_deref_mut(), Some(&mut geodesic));
        (geodesic, blended)
    }

    /// The chart split in two on its surface, else in its plane, else face by face.
    pub(crate) fn split_in_space(&mut self) -> crate::Result<()> {
        if self.faces.len() == 1 {
            self.parameterize_one_face(self.has_signal(), 0);
            return Ok(());
        }
        self.order_split_landmarks();
        let sources = self.landmarks[..2].to_vec();
        let (geodesic, blended) = self.distances_from_two(&sources);
        let combined = blended.as_deref().unwrap_or(&geodesic);
        let split = self.partition_general(&geodesic, combined, &[0, 1], true)?;
        if split && self.children.len() > 1 {
            return Ok(());
        }
        self.children.clear();
        self.split_in_plane()?;
        if self.children.len() != 2 {
            self.children.clear();
            self.partition_each_face()?;
        }
        Ok(())
    }

    /// The chart split in two by plane distance from its two vertices farthest apart in the
    /// plane.
    fn split_in_plane(&mut self) -> crate::Result<()> {
        let all: Vec<u32> = (0..self.verts.len() as u32).collect();
        let (a, b) = match farthest_pair(self, &all) {
            (NONE, _) => (0, 0),
            pair => pair,
        };
        let (geodesic, blended) = self.distances_from_two(&[a, b]);
        let combined = blended.as_deref().unwrap_or(&geodesic);
        self.split_by_distance(combined, &[0, 1])
    }
}
