//! The charts found again and measured for the packing.
//!
//! The charts: from each face not yet reached, in order, the faces reached breadth first across
//! the partition's adjacency; each chart's faces are laid one after another with their adjacency
//! and their input corners, and each input vertex, the first time a corner names it, takes the
//! next packer vertex with its plane position.
//!
//! The measures: a chart whose box collapses to a point under some turn is left out. Any other is
//! turned by the angle of least box area among 5°, 10°, … 90° (the turn kept from an earlier chart
//! when none is under 10¹⁰); its area is summed; in each of its 5 packing turns, from 0° by 18°,
//! its box (from 10¹⁰ apart), its longest side at the first turn, and its boundary edges — the
//! face edges without a face across, or every face edge once a face has two corners in the same
//! place.
use super::matrix::{Matrix, PI};
use super::{Packer, Range, Segment, TURNS};
use crate::hlod::flatten::uv::spectral::fail::failed;
use crate::hlod::flatten::uv::spectral::mesh::NONE;

/// The turns a chart's best angle is chosen among, every 5°.
const BEST_TURN_STEP: f32 = 5.0;
/// Boxes and areas start this far out.
const FAR: f32 = 1e10;

impl Segment {
    fn new(p1: [f32; 2], p2: [f32; 2]) -> Segment {
        let least = |a: f32, b: f32| if b < a { b } else { a };
        let most = |a: f32, b: f32| if a < b { b } else { a };
        Segment {
            p1,
            p2,
            low: [least(p1[0], p2[0]), least(p1[1], p2[1])],
            high: [most(p1[0], p2[0]), most(p1[1], p2[1])],
        }
    }
}

/// The box of `points`, from `FAR` apart.
fn bounds(points: &[[f32; 2]]) -> ([f32; 2], [f32; 2]) {
    let (mut low, mut high) = ([FAR; 2], [-FAR; 2]);
    for p in points {
        for k in 0..2 {
            if p[k] < low[k] {
                low[k] = p[k];
            }
            if p[k] > high[k] {
                high[k] = p[k];
            }
        }
    }
    (low, high)
}

impl<'d> Packer<'d> {
    /// The charts of the partition's adjacency `adjacency` over the input's `indices` and plane
    /// positions `uvs`.
    pub(super) fn collect_charts(&mut self, adjacency: &[u32], indices: &[u32], uvs: &[[f32; 2]]) {
        let faces = indices.len() / 3;
        let mut label = vec![NONE; faces];
        let mut reached = vec![false; faces];
        self.adjacency = vec![0; 3 * faces];
        self.local_of = vec![NONE; uvs.len()];
        let mut face_start = 0;
        for i in 0..faces {
            if label[i] != NONE {
                continue;
            }
            let mut group = Vec::new();
            if !reached[i] {
                group.push(i);
                reached[i] = true;
            }
            let mut t = 0;
            while t < group.len() {
                label[group[t]] = self.ranges.len() as u32;
                for &across in &adjacency[3 * group[t]..3 * group[t] + 3] {
                    if (across as usize) < faces && !reached[across as usize] {
                        group.push(across as usize);
                        reached[across as usize] = true;
                    }
                }
                t += 1;
            }
            let vertex_start = self.uvs.len();
            for (j, &f) in group.iter().enumerate() {
                let at = 3 * (face_start + j);
                self.adjacency[at..at + 3].copy_from_slice(&adjacency[3 * f..3 * f + 3]);
                for &v in &indices[3 * f..3 * f + 3] {
                    self.indices.push(v);
                    if self.local_of[v as usize] == NONE {
                        self.local_of[v as usize] = self.uvs.len() as u32;
                        self.uvs.push(uvs[v as usize]);
                    }
                }
            }
            self.ranges.push(Range {
                vertex_start,
                vertex_count: self.uvs.len() - vertex_start,
                face_start,
                face_count: group.len(),
            });
            face_start += group.len();
        }
    }

    /// The packer vertices of the corners of chart face `f` (in the packer's face order).
    fn corners(&self, f: usize) -> [usize; 3] {
        [0, 1, 2].map(|k| self.local_of[self.indices[3 * f + k] as usize] as usize)
    }

    /// Chart `i`'s plane area.
    fn chart_area(&self, i: usize) -> f32 {
        let range = &self.ranges[i];
        let mut area = 0.0f32;
        for f in range.face_start..range.face_start + range.face_count {
            let [p1, p2, p3] = self.corners(f).map(|v| self.uvs[v]);
            area +=
                ((p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])).abs() / 2.0;
        }
        area
    }

    /// Chart `i`'s plane positions through `matrix`.
    fn turned(&self, i: usize, matrix: &Matrix) -> Vec<[f32; 2]> {
        let range = &self.ranges[i];
        self.uvs[range.vertex_start..range.vertex_start + range.vertex_count]
            .iter()
            .map(|&p| matrix.apply(p))
            .collect()
    }

    /// Every chart turned to its best angle and measured in its packing turns.
    pub(super) fn measure_charts(&mut self) -> crate::Result<()> {
        let mut best = Matrix::identity();
        for i in 0..self.ranges.len() {
            let mut least = FAR;
            let mut collapsed = false;
            for j in 1..=(90.0 / BEST_TURN_STEP) as usize {
                let mut angle = j as f32 * BEST_TURN_STEP / 180.0 * PI;
                if angle > PI / 2.0 {
                    angle = PI / 2.0;
                }
                let rotation = Matrix::rotation(angle);
                let (low, high) = bounds(&self.turned(i, &rotation));
                if high[0] == low[0] && high[1] == low[1] {
                    collapsed = true;
                    break;
                }
                let area = (high[0] - low[0]) * (high[1] - low[1]);
                if area < least {
                    least = area;
                    best = rotation;
                }
            }
            if collapsed {
                self.charts[i].valid = false;
                continue;
            }
            let turned = self.turned(i, &best);
            let start = self.ranges[i].vertex_start;
            self.uvs[start..start + turned.len()].copy_from_slice(&turned);
            self.charts[i].valid = true;
            self.charts[i].area = self.chart_area(i);
            self.total_area += self.charts[i].area;
            for j in 0..TURNS {
                self.measure_turn(i, j)?;
            }
        }
        Ok(())
    }

    /// Chart `i` in packing turn `j`: its box, its longest side at the first turn, its edges.
    fn measure_turn(&mut self, i: usize, j: usize) -> crate::Result<()> {
        let angle = j as f32 * PI / TURNS as f32 / 2.0;
        let points = self.turned(i, &Matrix::rotation(angle));
        let (low, high) = bounds(&points);
        let range = &self.ranges[i];
        let start = range.vertex_start;
        let point = |v: usize| -> crate::Result<[f32; 2]> {
            v.checked_sub(start)
                .and_then(|k| points.get(k).copied())
                .ok_or_else(|| failed("a vertex lies in two charts"))
        };
        let mut edges = Vec::new();
        for f in range.face_start..range.face_start + range.face_count {
            let [a, b, c] = self.corners(f);
            let (v1, v2, v3) = (point(a)?, point(b)?, point(c)?);
            if v1 == v2 || v1 == v3 || v3 == v2 {
                edges.clear();
                for t in range.face_start..range.face_start + range.face_count {
                    let [a, b, c] = self.corners(t);
                    let (w1, w2, w3) = (point(a)?, point(b)?, point(c)?);
                    edges.extend([
                        Segment::new(w1, w2),
                        Segment::new(w2, w3),
                        Segment::new(w3, w1),
                    ]);
                }
                break;
            }
            for (k, (p, q)) in [(v1, v2), (v2, v3), (v3, v1)].into_iter().enumerate() {
                if self.adjacency[3 * f + k] == NONE {
                    edges.push(Segment::new(p, q));
                }
            }
        }
        let chart = &mut self.charts[i];
        let turn = &mut chart.turns[j];
        (turn.angle, turn.low, turn.high, turn.edges) = (angle, low, high, edges);
        if j == 0 {
            let (w, h) = (high[0] - low[0], high[1] - low[1]);
            chart.longest = if w < h { h } else { w };
        }
        Ok(())
    }
}
