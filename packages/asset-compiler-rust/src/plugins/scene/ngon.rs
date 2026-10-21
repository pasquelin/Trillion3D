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
//! and the cut says so to the caller, which counts it (`codes::NGON_UNCUT`).
//!
//! The cut (`ears`) walks a linked ring, so taking an ear costs nothing, and tests an ear only
//! against the corners that can lie in it — those that do not turn strictly convex — found
//! through a grid over the projected ring: a convex ring is cut in linear time, a large concave
//! one far under the quadratic scan. The cancellation token is reread inside a face too.
mod convex;
mod ears;
#[cfg(test)]
mod tests;
use super::cancel;
use std::sync::atomic::AtomicBool;
use trillion3d_math::geometry::triangle::newell;

/// A reusable cutter: the ring, its projection, the ranks still alive and the triangles serve
/// from one face to the next, so a mesh of a thousand faces does not allocate a thousand times.
#[derive(Default)]
pub(super) struct Ngon {
    ring: Vec<[f64; 3]>,
    flat: Vec<[f64; 2]>,
    /// The living ring as links: the corner before and after each, and whether it still lives.
    prev: Vec<usize>,
    next: Vec<usize>,
    alive: Vec<bool>,
    /// The corners an ear may contain — those that do not turn strictly convex — and the grid
    /// that finds them under a triangle (`ears::Grid`).
    candidate: Vec<bool>,
    grid: ears::Grid,
    triangles: Vec<[usize; 3]>,
    /// Faces and ears this cutter has already cut: it is this count that bounds rereading the
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
        self.ears(turn, cancelled)
    }

    /// Triangles of the last cut, as corner ranks of the ring.
    pub(super) fn triangles(&self) -> &[[usize; 3]] {
        &self.triangles
    }

    /// Fan from the first corner: what a ring with no plane yields for lack of better.
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
}
