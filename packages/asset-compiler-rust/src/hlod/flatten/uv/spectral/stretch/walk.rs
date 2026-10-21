//! One vertex moved: positions drawn at random on the circle around its centre, each searched by
//! halving the segment from the best position so far, the best kept when it lowers the vertex's
//! stretch.
//!
//! The draws restart the generator at 2 for each vertex, so a vertex's move never depends on the
//! moves before it. Each draw is an angle `draw · 2π / DRAW_MAX` on the circle; a boundary vertex
//! that must stay in the chart's box is pushed back above its low corner. The segment from the
//! start to the drawn point is halved while it is longer than the tolerance and keeps shrinking,
//! the half of greater stretch replaced by the middle; when both ends have the same zero signal
//! stretch on a boundary vertex, the end around which the faces cover more plane area is replaced,
//! so the chart's plane area shrinks where the signal is flat. The better end becomes the start of
//! the next draw.
//!
//! The vertex then takes the better of the search's result and the prepared candidate, when that
//! one is finite and lower than where it started; the faces' and the neighbours' stretches follow.
use super::optimize::Plan;
use super::vertex::Probe;
use super::INFINITE_STRETCH;
use crate::hlod::flatten::uv::spectral::draw::{next, seed, DRAW_MAX};
use crate::hlod::flatten::uv::spectral::mesh::Chart;
use crate::hlod::flatten::uv::spectral::util::{near_zero, near_zero2, signed_area_2d};
use std::f32::consts::PI;
use trillion3d_math::vector::vecn::distance2;

/// The seed each vertex's draws restart from.
const MOVE_SEED: u32 = 2;

impl<'a> Chart<'a> {
    /// The stretch of vertex `v` at `uv`, its faces' stretches written to `faces`; infinite when
    /// a signal move would fold a face or take its geometric stretch out of the expected bounds.
    pub(super) fn try_move(&self, v: u32, plan: &Plan, uv: [f32; 2], faces: &mut [f32]) -> f32 {
        let mut stretch = 0.0;
        let expected = self.source.expected_l2.get();
        for (i, &f) in self.verts[v as usize].faces.iter().enumerate() {
            let corners = self.corners_with(f as usize, v, uv);
            let (s, area_2d, geometric) =
                self.face_stretch(plan.ln, plan.signal, f as usize, corners, plan.scale);
            faces[i] = s;
            let area_3d = self.source.areas[self.faces[f as usize].root as usize];
            if plan.ln || !plan.signal || near_zero2(area_3d) {
                continue;
            }
            let g = geometric.expect("a signal stretch's geometric tensor");
            if area_2d < 0.0 || g[0] == INFINITE_STRETCH || g[2] == INFINITE_STRETCH {
                stretch = INFINITE_STRETCH;
            }
            if g[0] + g[2] > expected * 2.0 {
                stretch = INFINITE_STRETCH;
            }
            if g[0] + g[2] < self.source.expected_min_l2 * 2.0 {
                stretch = INFINITE_STRETCH;
            }
        }
        if stretch == INFINITE_STRETCH {
            return stretch;
        }
        self.adjusted_stretch(plan.ln, v, faces)
    }

    /// A vertex's stretch from its faces' stretches in ring order: their largest, or their sum,
    /// infinite when one is.
    fn adjusted_stretch(&self, ln: bool, v: u32, faces: &[f32]) -> f32 {
        let count = self.verts[v as usize].faces.len();
        let mut stretch = 0.0;
        for &s in &faces[..count] {
            if ln {
                if stretch < s {
                    stretch = s;
                }
            } else {
                if s == INFINITE_STRETCH {
                    return INFINITE_STRETCH;
                }
                stretch += s;
            }
        }
        stretch
    }

    /// The signed plane area of the faces around vertex `v` with it at `uv`.
    fn area_around(&self, v: u32, uv: [f32; 2]) -> f32 {
        let faces = &self.verts[v as usize].faces;
        faces.iter().fold(0.0, |sum, &f| {
            let [a, b, c] = self.corners_with(f as usize, v, uv);
            sum + signed_area_2d(a, b, c)
        })
    }

    /// Vertex `probe.v` moved by the random search; whether it moved.
    pub(super) fn walk_around_center(&mut self, plan: &mut Plan, probe: &mut Probe) -> bool {
        let v = probe.v;
        let boundary = self.verts[v as usize].boundary;
        let original_start_stretch = probe.start_stretch;
        let (original_end, original_end_stretch) = (probe.end, probe.end_stretch);
        let tolerance = plan.mean_edge * plan.mean_edge * plan.tolerance * plan.tolerance;
        let signal = plan.signal;
        let flat = |p: &Probe| {
            p.start_stretch == p.end_stretch && boundary && signal && near_zero(p.end_stretch)
        };
        seed(&self.source.draw, MOVE_SEED);
        for _ in 0..plan.draws {
            let angle = next(&self.source.draw) as f32 * 2.0 * PI / DRAW_MAX as f32;
            probe.end = [
                probe.center[0] + probe.radius * angle.cos(),
                probe.center[1] + probe.radius * angle.sin(),
            ];
            if boundary && plan.use_bounds {
                let low = |bound: f32, x: f32| if bound < x { x } else { bound };
                probe.end = [
                    low(plan.low[0], probe.end[0]),
                    low(plan.low[1], probe.end[1]),
                ];
            }
            probe.end_stretch = self.try_move(v, plan, probe.end, &mut probe.end_faces);
            let mut difference = distance2(probe.start, probe.end);
            let mut previous = difference;
            while difference > tolerance {
                let middle = [
                    (probe.start[0] + probe.end[0]) / 2.0,
                    (probe.start[1] + probe.end[1]) / 2.0,
                ];
                let stretch = self.try_move(v, plan, middle, &mut probe.work);
                let replace_end = if flat(probe) {
                    self.area_around(v, probe.start) < self.area_around(v, probe.end)
                } else {
                    probe.start_stretch < probe.end_stretch
                };
                if replace_end {
                    probe.end_stretch = stretch;
                    probe.end = middle;
                } else {
                    probe.start_stretch = stretch;
                    probe.start = middle;
                }
                difference = distance2(probe.start, probe.end);
                if near_zero2(previous - difference) || previous < difference {
                    break;
                }
                previous = difference;
            }
            let take_end = if flat(probe) {
                self.area_around(v, probe.start) > self.area_around(v, probe.end)
            } else {
                probe.start_stretch > probe.end_stretch
            };
            if take_end {
                probe.start = probe.end;
                probe.start_stretch = probe.end_stretch;
            }
        }
        if flat(probe) {
            probe.end_stretch = probe.start_stretch;
            probe.end = probe.start;
            let uv = self.verts[v as usize].uv;
            if self.area_around(v, uv) > self.area_around(v, probe.end) {
                probe.end_stretch = self.try_move(v, plan, probe.end, &mut probe.end_faces);
                self.apply_move(plan, v, probe.end, probe.end_stretch, &probe.end_faces);
                return true;
            }
            return false;
        }
        if probe.start_stretch >= original_end_stretch {
            probe.end_stretch = original_end_stretch;
            probe.end = original_end;
        } else {
            probe.end_stretch = probe.start_stretch;
            probe.end = probe.start;
        }
        if probe.end_stretch < INFINITE_STRETCH && probe.end_stretch < original_start_stretch {
            probe.end_stretch = self.try_move(v, plan, probe.end, &mut probe.end_faces);
            self.apply_move(plan, v, probe.end, probe.end_stretch, &probe.end_faces);
            return true;
        }
        false
    }

    /// Vertex `v` placed at `uv` with stretch `stretch` and its faces' stretches `faces`; its
    /// neighbours' stretches remeasured.
    fn apply_move(&mut self, plan: &mut Plan, v: u32, uv: [f32; 2], stretch: f32, faces: &[f32]) {
        plan.vert_stretch[v as usize] = stretch;
        self.verts[v as usize].uv = uv;
        for (i, &f) in self.verts[v as usize].faces.iter().enumerate() {
            plan.face_stretch[f as usize] = faces[i];
        }
        for &n in &self.verts[v as usize].verts {
            plan.vert_stretch[n as usize] =
                self.vertex_stretch(plan.ln, n as usize, &plan.face_stretch);
        }
    }
}
