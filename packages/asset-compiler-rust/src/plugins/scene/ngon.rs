//! Triangulation of an arbitrary polygon, shared by the drivers that read n-gons.
//!
//! A fan from the first corner adds surface as soon as the polygon is concave: its triangles
//! leave the face, and the rendered area exceeds the written area — a U-shaped polygon of area
//! seven yields eleven. Ears, on the other hand, only cut triangles whose interior is empty:
//! the area and silhouette of a simple polygon are kept exactly. On a convex polygon, the cut
//! falls corner by corner on the fan, so the output of a convex scene does not move by one
//! index.
//!
//! The polygon is read in its own plane, that of its Newell normal: the dominant axis of that
//! normal is left aside, and the other two carry the cut. A polygon with no plane — vertices
//! all colinear, zero area, non-finite coordinates — has no ear to cut: it comes out as a fan,
//! and the cut says so to the caller, which counts it under its own name.
//!
//! A strictly convex ring is recognised in one pass and written as the fan at once, which is
//! what the ears would have cut (`convex` says why); everything else goes through the ears.
mod convex;
mod plane;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_convex;
use super::cancel;
use plane::{newell, side};
use std::sync::atomic::AtomicBool;

/// A reusable cutter: the ring, its projection, the ranks still alive and the triangles serve
/// from one face to the next, so a mesh of a thousand faces does not allocate a thousand times.
#[derive(Default)]
pub(super) struct Ngon {
    ring: Vec<[f64; 3]>,
    flat: Vec<[f64; 2]>,
    alive: Vec<usize>,
    triangles: Vec<[usize; 3]>,
    /// Faces this cutter has already cut: it is this count that bounds rereading the
    /// cancellation token, once per slice.
    done: usize,
}

impl Ngon {
    /// Opens an empty ring: corners are then given in polygon order.
    pub(super) fn begin(&mut self) {
        self.ring.clear();
    }

    /// Adds a corner to the open ring.
    pub(super) fn corner(&mut self, point: [f64; 3]) {
        self.ring.push(point);
    }

    /// Cuts the ring. Yields `None` when the cancellation token is raised: the cutter rereads
    /// it itself, per face slice, so a single huge mesh stops too, and no driver has to
    /// remember. Yields `Some(false)` when an ear was missing — a self-intersecting polygon, or
    /// with no plane: the yielded triangles then fall back on the fan, and the caller counts
    /// the face.
    pub(super) fn cut(&mut self, cancelled: &AtomicBool) -> Option<bool> {
        if cancel::stopped(cancelled, self.done) {
            return None;
        }
        self.done += 1;
        self.triangles.clear();
        if self.ring.len() < 3 {
            return Some(true);
        }
        let Some(turn) = self.project() else {
            self.fan();
            return Some(false);
        };
        if convex::fan_is_exact(&self.flat, turn) {
            self.fan();
            return Some(true);
        }
        Some(self.ears(turn))
    }

    /// Ear cut of the projected ring, walked in the sense `turn`: true when every triangle
    /// was an ear, false when one had to be forced.
    fn ears(&mut self, turn: f64) -> bool {
        self.alive.clear();
        self.alive.extend(0..self.ring.len());
        let mut exact = true;
        let mut at = 1;
        while self.alive.len() > 3 {
            let found = (0..self.alive.len())
                .map(|step| (at + step) % self.alive.len())
                .find(|rank| self.is_ear(*rank, turn));
            let rank = found.unwrap_or_else(|| self.widest(turn));
            exact &= found.is_some();
            let (before, after) = self.neighbours(rank);
            self.triangles
                .push([self.alive[before], self.alive[rank], self.alive[after]]);
            self.alive.remove(rank);
            at = rank % self.alive.len();
        }
        self.triangles
            .push([self.alive[0], self.alive[1], self.alive[2]]);
        exact
    }

    /// Triangles of the last cut, as corner ranks of the ring.
    pub(super) fn triangles(&self) -> &[[usize; 3]] {
        &self.triangles
    }

    /// Fan from the first corner: the cut of a strictly convex ring, and what a ring with no
    /// plane yields for lack of better.
    fn fan(&mut self) {
        for step in 1..self.ring.len() - 1 {
            self.triangles.push([0, step, step + 1]);
        }
    }

    /// Projects the ring into the plane of its Newell normal and yields the sense of its walk
    /// in that projection: `1.0` for the direct sense, `-1.0` for the other. `None` when the
    /// polygon has neither normal nor area: there is then no plane in which to cut it.
    fn project(&mut self) -> Option<f64> {
        let normal = newell(&self.ring);
        let axis = (0..3).fold(0, |best, axis| {
            match normal[axis].abs() > normal[best].abs() {
                true => axis,
                false => best,
            }
        });
        if !normal[axis].is_finite() || normal[axis] == 0.0 {
            return None;
        }
        let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
        self.flat.clear();
        self.flat
            .extend(self.ring.iter().map(|point| [point[u], point[v]]));
        // Signed area of the projection is the `axis` component of the Newell normal, already
        // finite and non-zero: its sign is the walk sense.
        Some(normal[axis].signum())
    }

    /// Ranks that frame a living rank.
    fn neighbours(&self, rank: usize) -> (usize, usize) {
        let sides = self.alive.len();
        ((rank + sides - 1) % sides, (rank + 1) % sides)
    }

    /// Triangle of a living rank, in the cut plane.
    fn ear(&self, rank: usize) -> [[f64; 2]; 3] {
        let (before, after) = self.neighbours(rank);
        [
            self.flat[self.alive[before]],
            self.flat[self.alive[rank]],
            self.flat[self.alive[after]],
        ]
    }

    /// Is this rank an ear? Its corner must not turn into the polygon, and no other living
    /// vertex must fall in its triangle, border included: a vertex sitting on the diagonal
    /// stays there after the cut, on the wrong side of the remaining edge, and the next
    /// triangle starts backwards. An aligned or duplicated corner passes: its triangle has
    /// zero area, so it adds no surface, contains nothing, and the cut always advances.
    fn is_ear(&self, rank: usize, turn: f64) -> bool {
        let [a, b, c] = self.ear(rank);
        let area = turn * side(a, b, c);
        if area < 0.0 {
            return false;
        }
        if area == 0.0 {
            return true;
        }
        let (before, after) = self.neighbours(rank);
        let corners = [self.alive[before], self.alive[rank], self.alive[after]];
        !self.alive.iter().any(|other| {
            !corners.contains(other) && {
                let point = self.flat[*other];
                ![a, b, c].contains(&point)
                    && turn * side(a, b, point) >= 0.0
                    && turn * side(b, c, point) >= 0.0
                    && turn * side(c, a, point) >= 0.0
            }
        })
    }

    /// Most salient rank, cut by force when no ear presents itself: a self-intersecting
    /// polygon has none, and the cut must finish. The first wins on a tie.
    fn widest(&self, turn: f64) -> usize {
        let saliency = |rank: &usize| {
            let [a, b, c] = self.ear(*rank);
            turn * side(a, b, c)
        };
        (0..self.alive.len())
            .rev()
            .max_by(|x, y| saliency(x).total_cmp(&saliency(y)))
            .unwrap_or_default()
    }
}
