//! One window unfolded across the face beyond its edge.
//!
//! The face is laid in the window's edge frame, its third corner below the edge. The rays from the
//! pseudo source through the window's two ends are crossed with the face's two other edges; where
//! they land decides the new windows:
//!
//! 1. one ray on each edge (each end's ray on its own side): a window on each edge, from the
//!    third corner to the ray;
//! 2. both rays on the edge of the window's far end: a window on that edge between the rays; when
//!    the window starts at its mark end and that vertex bends geodesics (a saddle or boundary
//!    vertex), a window from that vertex covering the rest of the edge, and its shadow (`shadow`);
//! 3. both rays on the edge of the mark end: the mirror case, around the far end.
//!
//! Windows of no width (under `f32::EPSILON`) are dropped; so are windows on a boundary edge,
//! which no face continues.
use super::plane::{distance, into_frame_2d, into_frame_3d, line_crossing};
use super::{Window, Windows};
use crate::hlod::flatten::uv::spectral::mesh::NONE;

/// Widths and lengths under this are none.
pub(super) const EPS: f64 = f32::EPSILON as f64;
/// A point no line reaches.
const FAR: f64 = f32::MAX as f64;

impl Windows {
    /// `w` unfolded across the face beyond its edge.
    pub(super) fn propagate(&mut self, w: &Window) {
        let edge = &self.edges[w.edge as usize];
        if edge.faces[0] == NONE || edge.faces[1] == NONE || (w.b0 - w.b1).abs() <= EPS {
            return;
        }
        let face_to = edge.other_face(w.from_face);
        let [mut edge0, mut edge1] = self.faces[face_to as usize].other_edges(w.edge);
        if !self.edges[edge0 as usize].verts.contains(&w.mark) {
            std::mem::swap(&mut edge0, &mut edge1);
        }
        let third = self.edges[edge0 as usize].other_end(w.mark);
        let far_end = self.edges[w.edge as usize].other_end(w.mark);
        let (p_mark, p_far, p_third) = (
            self.verts[w.mark as usize].p,
            self.verts[far_end as usize].p,
            self.verts[third as usize].p,
        );
        let (length0, length1) = (
            self.edges[edge0 as usize].length,
            self.edges[edge1 as usize].length,
        );
        let w0 = [w.b0, 0.0];
        let mut w1 = [w.b1, 0.0];
        let w2 = w.src;
        let q0 = [0.0, 0.0];
        let q1 = [self.edges[w.edge as usize].length, 0.0];
        if w1[0] > q1[0] {
            w1[0] = q1[0];
        }
        let mut q2 = into_frame_3d(p_mark, p_far, p_third);
        q2[1] = -q2[1];
        let (mut w0_on_02, mut at_w0_02) = line_crossing(q0, q2, w2, w0);
        if w0_on_02[0] == FAR && (w0[0] - q0[0]).abs() < EPS {
            at_w0_02 = true;
            w0_on_02 = q0;
        }
        let (w0_on_12, at_w0_12) = line_crossing(q1, q2, w2, w0);
        let (w1_on_02, at_w1_02) = line_crossing(q0, q2, w2, w1);
        let (mut w1_on_12, mut at_w1_12) = line_crossing(q1, q2, w2, w1);
        if w1_on_12[0] == FAR && (q1[0] - w1[0]).abs() < EPS {
            at_w1_12 = true;
            w1_on_12 = q1;
        }
        let carried = |edge: u32| Window {
            edge,
            mark: third,
            pseudo: w.pseudo,
            pseudo_distance: w.pseudo_distance,
            from_face: face_to,
            ksi: w.ksi,
            ..Window::default()
        };
        if at_w0_02 && at_w1_12 && !at_w1_02 && !at_w0_12 {
            let mut first = carried(edge0);
            first.b1 = distance(w0_on_02, q2);
            if first.b1 > EPS {
                let at_end = w0[0] == q0[0];
                if at_end {
                    first.b1 = length0;
                }
                first.d0 = distance(w2, q2);
                first.d1 = distance(if at_end { q0 } else { w0_on_02 }, w2);
                first.src = into_frame_2d(q2, q0, w2);
                self.offer(first);
            }
            let mut second = carried(edge1);
            second.b1 = distance(w1_on_12, q2);
            if second.b1 > EPS {
                let at_end = w1[0] == q1[0];
                if at_end {
                    second.b1 = length1;
                }
                second.d0 = distance(w2, q2);
                second.d1 = distance(if at_end { q1 } else { w1_on_12 }, w2);
                second.src = into_frame_2d(q2, q1, w2);
                self.offer(second);
            }
        } else if at_w0_12 && at_w1_12 {
            let mut inner = carried(edge1);
            inner.b0 = distance(w0_on_12, q2);
            if inner.b0 < EPS {
                inner.b0 = 0.0;
            }
            let at_end = w1[0] == q1[0];
            inner.b1 = if at_end {
                length1
            } else {
                distance(w1_on_12, q2)
            };
            inner.d1 = distance(if at_end { q1 } else { w1_on_12 }, w2);
            inner.src = into_frame_2d(q2, q1, w2);
            inner.d0 = distance(w0_on_12, w2);
            self.offer(inner);
            if w0[0] == q0[0] && self.verts[w.mark as usize].saddle_or_boundary() {
                let mut around = carried(edge1);
                around.pseudo = w.mark;
                around.pseudo_distance = w.pseudo_distance + w.d0;
                around.b1 = distance(w0_on_12, q2);
                around.d0 = length0;
                around.d1 = distance(w0_on_12, q0);
                around.src = into_frame_3d(p_third, p_far, p_mark);
                self.offer(around);
                self.shadow(w, third, edge0, face_to, w.mark, w.d0);
            }
        } else if at_w0_02 && at_w1_02 {
            let mut inner = carried(edge0);
            inner.b0 = distance(w1_on_02, q2);
            if inner.b0 < EPS {
                inner.b0 = 0.0;
            }
            let at_end = w0[0] == q0[0];
            inner.b1 = if at_end {
                length0
            } else {
                distance(w0_on_02, q2)
            };
            inner.d1 = distance(if at_end { q0 } else { w0_on_02 }, w2);
            inner.src = into_frame_2d(q2, q0, w2);
            inner.d0 = distance(w1_on_02, w2);
            self.offer(inner);
            if w1[0] == q1[0] && self.verts[far_end as usize].saddle_or_boundary() {
                let mut around = carried(edge0);
                around.pseudo = far_end;
                around.pseudo_distance = w.pseudo_distance + w.d1;
                around.b1 = distance(w1_on_02, q2);
                around.d0 = length1;
                around.d1 = distance(w1_on_02, q1);
                around.src = into_frame_3d(p_third, p_mark, p_far);
                self.offer(around);
                self.shadow(w, third, edge1, face_to, far_end, w.d1);
            }
        }
    }

    /// `window` cut into its edge unless it has no width.
    pub(super) fn offer(&mut self, window: Window) {
        if window.b1 - window.b0 > EPS {
            self.insert_window(window);
        }
    }
}
