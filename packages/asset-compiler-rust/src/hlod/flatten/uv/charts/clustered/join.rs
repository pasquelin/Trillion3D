//! A face joining a chart, and the test that keeps the chart valid. A face always joins with its
//! whole planar region. A chart's frame is its first face's normal and first edge while it has one
//! region, the plane fitted to its corners (`fit_frame`) after, turned to its newest face's side.
//!
//! A face is refused, its region then never offered to the chart again, when no plane fits or when
//! the chart projected on its frame (the frame before the face joined) has some but not all faces
//! turned, or boundary edges that cross (`EdgeGrid`); the chart is then left as it was. A face that
//! joins gives the chart its new frame, the chart's area and boundary are measured with its region
//! and its faces' centres summed in, and the chart's candidates are rebuilt. Merging two
//! neighbouring charts (`merge`) runs the same fit and the same projection test on their faces
//! together.
use super::super::fit::fit_frame;
use super::super::grid::{Against, Corners};
use super::super::mesh::NONE;
use super::super::vector::{negate, unit, uv_half_area, Frame, MESH_EPSILON};
use super::{Cluster, Growth};
use trillion3d_math::vector::vecn::{add, dot, sub};

impl Growth<'_> {
    /// `face` and its planar region joined to `chart` if the chart stays valid; its candidates
    /// then rebuilt.
    pub(super) fn add_face(&mut self, chart: &mut Cluster, face: usize) -> bool {
        let (surface, planar) = (self.surface, self.planar);
        let mesh = &surface.mesh;
        let old_count = chart.faces.len();
        let first = old_count == 0;
        chart.faces.extend(planar.ring(face));
        let count = chart.faces.len();
        let frame = if first {
            let tangent = unit(sub(mesh.corner(face * 3), mesh.corner(face * 3 + 1)));
            Frame::new(surface.face_normals[face], tangent)
        } else {
            let Some(mut frame) = self.chart_frame(&chart.faces) else {
                chart.faces.truncate(old_count);
                return false;
            };
            if dot(frame.normal, surface.face_normals[face]) < 0.0 {
                frame.normal = negate(frame.normal);
            }
            self.project(chart);
            for &f in &chart.faces[old_count..] {
                self.face_charts[f] = chart.id;
            }
            if !self.projection_valid(chart) {
                for &f in &chart.faces[old_count..] {
                    self.face_charts[f] = -1;
                }
                chart.faces.truncate(old_count);
                return false;
            }
            frame
        };
        chart.frame = frame;
        chart.area = self.area_with(chart, face);
        chart.boundary_length = self.border(chart, face).boundary;
        for i in old_count..count {
            let f = chart.faces[i];
            self.face_charts[f] = chart.id;
            self.faces_left = self.faces_left.wrapping_sub(1);
            self.in_chart[f] = true;
            chart.centroid_sum = add(chart.centroid_sum, mesh.face_center(f));
        }
        self.rebuild_candidates(chart);
        true
    }

    /// The plane fitted to the corners of `faces`.
    pub(super) fn chart_frame(&mut self, faces: &[usize]) -> Option<Frame> {
        let mesh = &self.surface.mesh;
        self.points.clear();
        self.points
            .extend(faces.iter().flat_map(|&face| mesh.face_corners(face)));
        fit_frame(&self.points)
    }

    /// The chart's corners projected on its frame.
    pub(super) fn project(&mut self, chart: &Cluster) {
        let mesh = &self.surface.mesh;
        for &face in &chart.faces {
            for corner in face * 3..face * 3 + 3 {
                self.texcoords[corner] = chart.frame.project(mesh.corner(corner));
            }
        }
    }

    /// Whether the projection turns no face or all of them, and its boundary edges (those whose
    /// opposite face is in another chart, or none) never cross. `face_charts` must name the
    /// chart's faces.
    pub(super) fn projection_valid(&mut self, chart: &Cluster) -> bool {
        let mesh = &self.surface.mesh;
        let turned = (chart.faces.iter())
            .filter(|&&face| {
                let [a, b, c] = [0, 1, 2].map(|k| self.texcoords[face * 3 + k]);
                uv_half_area(a, b, c) > 0.0
            })
            .count();
        if turned != 0 && turned != chart.faces.len() {
            return false;
        }
        let face_charts = &self.face_charts;
        let border = (chart.faces.iter())
            .flat_map(|&face| face * 3..face * 3 + 3)
            .filter(|&edge| {
                let other = mesh.face_across(edge);
                other == NONE || face_charts[other] != chart.id
            });
        self.grid.reset_to(border);
        let corners = Corners::PerCorner(&self.texcoords);
        !self
            .grid
            .crosses_edges(corners, MESH_EPSILON, Against::Itself, &[])
    }
}
