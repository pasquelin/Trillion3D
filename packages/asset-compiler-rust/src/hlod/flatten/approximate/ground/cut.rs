//! The cut (`Shape::cut`), what lies on the side the cut's normal points to — below the ground —
//! taken away, each vertex's side its signed distance `(p − origin) · DOWN`, a vertex within
//! `ON_PLANE` of the plane lying on it:
//!
//! 1. every triangle whose three corners lie on the plane taken away, by ascending id, its corners
//!    left bare freed with it;
//! 2. every edge there was before the splits, by ascending id — none a split made, even in a
//!    freed edge's id —, split where it crosses the plane: one with an end on the plane recorded
//!    as on the plane when both are, one with both ends on a side left; the split's edge to the far
//!    corner of each triangle recorded as a cut edge when that corner lies on the plane — a vertex
//!    a split made lies on it, the signs it reads those of the vertex whose id it took;
//! 3. every vertex the distances found below the plane, by ascending id, taken away with its
//!    triangles, the corners they leave bare kept;
//! 4. the cut edges shorter than `DEGENERATE` collapsed onto their lower end, pass after pass over
//!    those not collapsed yet, in the order recorded, while one collapses;
//! 5. the boundary walked among the edges recorded on the plane and the cut edges left
//!    (`boundary_loops`).
use super::Shape;
use crate::hlod::flatten::mesh::{boundary_loops, Boundaries, Split, NONE};
use trillion3d_math::vector::vecn::{distance2, dot, sub, weighted_sum};

/// The cut's normal, pointing to the side taken away: the ground plane's upward normal negated,
/// each part, its zeros among them.
pub(super) const DOWN: [f64; 3] = [-0.0, -0.0, -1.0];

/// The distance within which a vertex lies on the plane: ten times single precision's zero
/// tolerance, read in double precision.
const ON_PLANE: f64 = 1e-6_f32 as f64 * 10.0;

/// The length at or under which a cut edge is collapsed: double precision's zero tolerance.
const DEGENERATE: f64 = 1e-8;

impl Shape {
    /// The shape cut at the plane through `origin` (module doc): the boundary the cut left.
    pub(super) fn cut(&mut self, origin: [f64; 3]) -> Boundaries {
        let signs: Vec<f64> = (0..self.mesh.vertex_count())
            .map(|v| match self.mesh.is_vertex(v) {
                true => dot(sub(self.points[v], origin), DOWN),
                false => 0.0,
            })
            .collect();
        for t in 0..self.mesh.triangles.len() {
            let on = |v: usize| signs[v].abs() < ON_PLANE;
            if self.mesh.is_triangle(t) && self.mesh.corners(t).iter().all(|&v| on(v)) {
                self.mesh.remove_triangle(t, true);
            }
        }
        let (on_plane, cut) = self.split_crossing(&signs);
        for (v, &sign) in signs.iter().enumerate() {
            if sign > ON_PLANE {
                self.mesh.remove_vertex(v);
            }
        }
        let cut = self.collapse_degenerate(cut);
        let mut kept = on_plane;
        kept.resize(self.mesh.edges.len(), false);
        for e in cut.into_iter().filter(|&e| e != NONE) {
            kept[e] = true;
        }
        let points = &self.points;
        boundary_loops(&self.mesh, |e| kept[e], |v| points[v])
    }

    /// The edges there were before any split, split where they cross the plane (module doc, step
    /// 2): by id, whether each lies on the plane, and the cut edges in the order made.
    fn split_crossing(&mut self, signs: &[f64]) -> (Vec<bool>, Vec<usize>) {
        let before = self.mesh.edges.len();
        let (mut made, mut on_plane) = (vec![false; before], vec![false; before]);
        let mut cut = Vec::new();
        let on = |sign: f64| sign.abs() < ON_PLANE;
        let lies_on = |v: usize| v >= signs.len() || on(signs[v]);
        for e in 0..before {
            if !self.mesh.is_edge(e) || made[e] {
                continue;
            }
            let [a, b] = self.mesh.ends(e);
            let (da, db) = (signs[a], signs[b]);
            if on(da) || on(db) {
                on_plane[e] = on(da) && on(db);
                continue;
            }
            if da * db > 0.0 {
                continue;
            }
            let Some(split) = self.split(e, da / (da - db)) else {
                continue;
            };
            let [to_end, to_far, from_far] = split.edges;
            for new in [to_end, to_far] {
                if new < before {
                    made[new] = true;
                }
            }
            if lies_on(split.across[0]) {
                cut.push(to_far);
            }
            if from_far != NONE {
                if from_far < before {
                    made[from_far] = true;
                }
                if lies_on(split.across[1]) {
                    cut.push(from_far);
                }
            }
        }
        (on_plane, cut)
    }

    /// Edge `e` split at share `t` of the way from its lower end (`Mesh::split_edge`), the new
    /// vertex's point `(1 − t)·a + t·b` between the ends as the split winds them.
    fn split(&mut self, e: usize, t: f64) -> Option<Split> {
        let split = self.mesh.split_edge(e, t)?;
        let [a, b] = split.ends;
        let point = weighted_sum([self.points[a], self.points[b]], [1.0 - split.t, split.t]);
        self.points.resize(self.mesh.vertex_count(), [0.0; 3]);
        self.points[split.vertex] = point;
        Some(split)
    }

    /// The cut edges of no length collapsed (module doc, step 4): the cut edges, a collapsed one
    /// replaced by `NONE`.
    fn collapse_degenerate(&mut self, mut cut: Vec<usize>) -> Vec<usize> {
        let least = DEGENERATE * DEGENERATE;
        loop {
            let mut collapsed = 0;
            for entry in &mut cut {
                let e = *entry;
                if e == NONE || !self.mesh.is_edge(e) {
                    continue;
                }
                let [keep, remove] = self.mesh.ends(e);
                if distance2(self.points[keep], self.points[remove]) > least {
                    continue;
                }
                if self.collapse(keep, remove) {
                    collapsed += 1;
                    *entry = NONE;
                }
            }
            if collapsed == 0 {
                return cut;
            }
        }
    }

    /// The edge between `keep` and `remove` collapsed onto `keep` (`Mesh::collapse_edge`), the
    /// kept point `1·kept + 0·removed`; whether it was.
    fn collapse(&mut self, keep: usize, remove: usize) -> bool {
        let (kept, removed) = (self.points[keep], self.points[remove]);
        let collapsed = self.mesh.collapse_edge(keep, remove).is_ok();
        if collapsed {
            self.points[keep] = weighted_sum([kept, removed], [1.0, 0.0]);
        }
        collapsed
    }
}
