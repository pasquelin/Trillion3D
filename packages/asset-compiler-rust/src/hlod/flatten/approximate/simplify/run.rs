//! Tolerance, flips, an edge collapse, the loop, the clean-up and compaction.
use super::{segment_parameter, Outcome, Simplifier, V3};
use crate::hlod::flatten::mesh::{Refused, NONE};
use trillion3d_math::geometry::triangle::facing;
use trillion3d_math::vector::vecn::{add, distance2, scale};
use trillion3d_page_codec::encode::vertices::first_use;

impl Simplifier {
    /// Whether the collapse stays within the geometric tolerance: the new point, the new
    /// midpoints of the other edges and the new centroids of the triangles that stay, all within
    /// the tolerance of the target.
    fn within_tolerance(&self, keep: usize, remove: usize, p: V3, tc: usize, td: usize) -> bool {
        let Some(target) = &self.target else {
            return true;
        };
        if !target.within(p) {
            return false;
        }
        let collapsing = self.mesh.find_edge(keep, remove);
        for v in [keep, remove] {
            for e in self.mesh.edges_at(v) {
                if Some(e) != collapsing {
                    let o = self.positions[self.mesh.other(e, v)];
                    if !target.within(scale(add(o, p), 0.5)) {
                        return false;
                    }
                }
            }
        }
        for v in [keep, remove] {
            for t in self.mesh.triangles_at(v) {
                if t == tc || t == td {
                    continue;
                }
                let centroid = self
                    .mesh
                    .corners(t)
                    .iter()
                    .map(|&x| {
                        if x == keep || x == remove {
                            p
                        } else {
                            self.positions[x]
                        }
                    })
                    .fold([0.0; 3], add);
                if !target.within(scale(centroid, 1.0 / 3.0)) {
                    return false;
                }
            }
        }
        true
    }

    /// Whether moving `v` to `p` turns any triangle about it over (its normal past 90°) or would
    /// join it to `other` twice.
    fn flips(&self, v: usize, other: usize, p: V3, tc: usize, td: usize) -> bool {
        for t in self.mesh.triangles_at(v) {
            if t == tc || t == td {
                continue;
            }
            let tri = self.mesh.corners(t);
            if tri.contains(&other) {
                return true;
            }
            let k = (0..2).find(|&k| tri[k] == v).unwrap_or(2);
            if facing(tri.map(|x| self.positions[x]), k, p) <= 0.0 {
                return true;
            }
        }
        false
    }

    /// Edge `e` collapsed to `new`, unless out of tolerance, flipping or not manifold.
    fn collapse_edge(&mut self, e: usize, new: V3) -> Outcome {
        if !self.mesh.is_edge(e) {
            return Outcome::Ignored;
        }
        let ([a, b], [t0, t1]) = (self.mesh.ends(e), self.mesh.faces(e));
        let mut collapse_to = NONE;
        if self.have_boundary {
            if self.boundary[b] {
                collapse_to = b;
            } else if self.boundary[a] {
                collapse_to = a;
            }
        }
        let (keep, remove) = if collapse_to == a { (a, b) } else { (b, a) };
        let (pkeep, premove) = (self.positions[keep], self.positions[remove]);
        let mut new = new;
        if !self.within_tolerance(keep, remove, new, t0, t1) {
            let t = segment_parameter(pkeep, premove, new);
            new = add(scale(pkeep, 1.0 - t), scale(premove, t));
            if !self.within_tolerance(keep, remove, new, t0, t1) {
                return Outcome::Ignored;
            }
        }
        if self.flips(a, b, new, t0, t1) || self.flips(b, a, new, t0, t1) {
            return Outcome::Ignored;
        }
        match self.mesh.collapse_edge(keep, remove) {
            Ok(done) => {
                self.positions[keep] = new;
                Outcome::Collapsed(keep, done.faces, done.across)
            }
            Err(Refused::Triangle) => Outcome::IsolatedTriangle,
            Err(Refused::Other) => Outcome::Ignored,
        }
    }

    /// Collapses, least error first, down to `target` triangles.
    pub(super) fn simplify_to(&mut self, target: usize) {
        if self.mesh.triangle_count() == 0 {
            return;
        }
        let target = target.max(1);
        // The mesh keeps the ids of the elements earlier passes removed (their slots hold no
        // quadric and no queue entry), as the order equal errors are queued in reads them.
        self.precompute();
        self.initialize();
        while self.mesh.triangle_count() > target {
            let Some(e) = self.queue.pop() else {
                break;
            };
            let e = e as usize;
            if !self.mesh.is_edge(e) {
                continue;
            }
            let point = self.collapse_points[e];
            match self.collapse_edge(e, point) {
                Outcome::Collapsed(kept, removed, opposing) => {
                    self.update_neighborhood(kept, removed, opposing)
                }
                Outcome::IsolatedTriangle if self.mesh.triangle_count() > 2 => {
                    let t = self.mesh.faces(e)[0];
                    self.remove_isolated(t);
                }
                _ => {}
            }
        }
    }

    /// Triangle `t` removed when no other triangle touches its vertices.
    fn remove_isolated(&mut self, t: usize) {
        if t == NONE || !self.mesh.is_triangle(t) {
            return;
        }
        let isolated =
            (self.mesh.corners(t).iter()).all(|&v| self.mesh.triangles_at(v).all(|x| x == t));
        if isolated {
            self.mesh.remove_triangle(t, true);
        }
    }

    /// Interior edges
    /// shorter than the length collapsed to their midpoints, round after round.
    pub(super) fn fast_collapse(
        &mut self,
        min_edge_length: f64,
        rounds: usize,
        min_triangles: usize,
    ) {
        if self.mesh.triangle_count() <= min_triangles {
            return;
        }
        let min2 = min_edge_length * min_edge_length;
        self.precompute();
        let count = self.mesh.edges.len();
        for _ in 0..rounds {
            let mut collapsed = 0usize;
            for e in 0..count {
                if !self.mesh.is_edge(e) || self.mesh.is_boundary(e) {
                    continue;
                }
                if self.mesh.triangle_count() <= min_triangles {
                    break;
                }
                let [pa, pb] = self.edge_points(e);
                if distance2(pa, pb) > min2 {
                    continue;
                }
                if let Outcome::Collapsed(..) = self.collapse_edge(e, scale(add(pa, pb), 0.5)) {
                    collapsed += 1;
                }
            }
            if collapsed == 0 || self.mesh.triangle_count() <= min_triangles {
                break;
            }
        }
    }

    /// The live triangles over the live vertices.
    pub(super) fn compact(&self) -> (Vec<V3>, Vec<u32>) {
        let live: Vec<u32> = (self.mesh.triangles.iter().enumerate())
            .filter(|&(t, _)| self.mesh.is_triangle(t))
            .flat_map(|(_, tri)| *tri)
            .collect();
        let (used, indices) = first_use(live.into_iter());
        let points = used.iter().map(|&v| self.positions[v as usize]).collect();
        (points, indices)
    }
}
