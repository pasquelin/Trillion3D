//! What a candidate face costs its chart, the face taken with its whole planar region: the sum of
//!
//! - `NORMAL_DEVIATION_WEIGHT` times one minus the dot product of its normal and the chart's (at
//!   most one); a face turned by about 75 degrees or more (`0.707`) is never a candidate;
//! - `NORMAL_SEAM_WEIGHT` times the share of the region's edges along the chart that are normal
//!   seams, each seam edge counted by one minus its faces' normals' dot product (held in
//!   `[0, 1]`);
//! - `ROUNDNESS_WEIGHT` times one minus the chart's squared boundary over area before, over the
//!   same after;
//! - `STRAIGHTNESS_WEIGHT` times the share of the region's outer boundary that does not border
//!   the chart less the share that does, when negative (it only rewards closing gaps).
//!
//! The mesh has no texture coordinates, so no edge is a texture seam and that weight adds nothing;
//! the chart's area and boundary are not bounded.
use super::super::mesh::NONE;
use super::super::vector::{clamp_to, least, most, near3, NORMAL_EPSILON};
use super::{Cluster, Growth};
use trillion3d_math::vector::vecn::dot;

const NORMAL_DEVIATION_WEIGHT: f32 = 2.0;
const ROUNDNESS_WEIGHT: f32 = 0.01;
const STRAIGHTNESS_WEIGHT: f32 = 6.0;
const NORMAL_SEAM_WEIGHT: f32 = 4.0;
/// The normal deviation from which a face is never a candidate.
const MAX_NORMAL_DEVIATION: f32 = 0.707;

/// A region's border against a chart: the edges of its faces to the mesh's boundary or to another
/// region, walked once in ring order, each sum in that order.
pub(super) struct Border {
    /// The length off the chart (on the mesh's boundary or to a face outside the chart), and the
    /// length along it.
    outside: f32,
    along: f32,
    /// The chart's boundary length with the region: the length off the chart added, the length
    /// along it taken away; never below zero.
    pub(super) boundary: f32,
    /// The normal-seam length along the chart, each seam edge counted by one minus its faces'
    /// normals' dot product (held in `[0, 1]`).
    seam: f32,
}

impl Border {
    /// The normal-seam length over the length along the chart: a candidate's region is free
    /// whole, so that length is all the region's faces have along the chart.
    fn seam_share(&self) -> f32 {
        if self.seam <= 0.0 {
            return 0.0;
        }
        self.seam / self.along
    }

    /// The share of the border off the chart less the share along it, at most zero.
    fn straightness(&self) -> f32 {
        least(
            (self.outside - self.along) / (self.outside + self.along),
            0.0,
        )
    }
}

impl Growth<'_> {
    /// The face's cost, `f32::MAX` when it may never join.
    pub(super) fn cost(&self, chart: &Cluster, face: usize) -> f32 {
        let deviation = self.deviation(chart, face);
        if deviation >= MAX_NORMAL_DEVIATION {
            return f32::MAX;
        }
        let border = self.border(chart, face);
        let new_area = self.area_with(chart, face);
        let mut cost = 0.0f32;
        cost += NORMAL_DEVIATION_WEIGHT * deviation;
        cost += NORMAL_SEAM_WEIGHT * border.seam_share();
        cost += ROUNDNESS_WEIGHT * roundness(chart, border.boundary, new_area);
        cost += STRAIGHTNESS_WEIGHT * border.straightness();
        cost
    }

    /// One minus the dot product of the face's normal and the chart's, at most one.
    pub(super) fn deviation(&self, chart: &Cluster, face: usize) -> f32 {
        least(
            1.0 - dot(self.surface.face_normals[face], chart.frame.normal),
            1.0,
        )
    }

    /// The border of `first`'s region against the chart.
    pub(super) fn border(&self, chart: &Cluster, first: usize) -> Border {
        let (mesh, normals) = (&self.surface.mesh, &self.surface.face_normals);
        let region = self.planar.region[first];
        let mut border = Border {
            outside: 0.0,
            along: 0.0,
            boundary: chart.boundary_length,
            seam: 0.0,
        };
        for face in self.planar.ring(first) {
            for edge in face * 3..face * 3 + 3 {
                let l = self.surface.edge_lengths[edge];
                let other = mesh.face_across(edge);
                if other != NONE && self.planar.region[other] == region {
                    continue;
                }
                if other == NONE || self.face_charts[other] != chart.id {
                    border.outside += l;
                    border.boundary += l;
                    continue;
                }
                border.along += l;
                border.boundary -= l;
                if mesh.joins_colocals(edge) && self.breaks_normals(edge) {
                    let d = clamp_to(dot(normals[face], normals[other]), 0.0, 1.0);
                    border.seam += l * (1.0 - d);
                }
            }
        }
        border.boundary = most(0.0, border.boundary);
        border
    }

    /// Whether an edge joins two regions whose faces' normals differ by more than
    /// `NORMAL_EPSILON` on some axis.
    pub(super) fn breaks_normals(&self, edge: usize) -> bool {
        let opposite = self.surface.mesh.opposite(edge);
        if opposite == NONE {
            return false;
        }
        let (f0, f1) = (edge / 3, opposite / 3);
        if self.planar.region[f0] == self.planar.region[f1] {
            return false;
        }
        !near3(
            self.surface.face_normals[f0],
            self.surface.face_normals[f1],
            NORMAL_EPSILON,
        )
    }

    /// The chart's area with the face's region.
    pub(super) fn area_with(&self, chart: &Cluster, first: usize) -> f32 {
        let mut area = chart.area;
        for face in self.planar.ring(first) {
            area += self.surface.face_areas[face];
        }
        area
    }
}

/// One minus the chart's squared boundary over area before, over the same after.
fn roundness(chart: &Cluster, new_boundary: f32, new_area: f32) -> f32 {
    let old = chart.boundary_length * chart.boundary_length / chart.area;
    let new = new_boundary * new_boundary / new_area;
    1.0 - old / new
}
