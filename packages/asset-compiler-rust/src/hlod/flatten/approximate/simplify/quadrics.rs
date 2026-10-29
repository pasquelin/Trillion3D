//! The quadrics: the optimal point, the score, their set-up and neighbourhood.
use super::{nearest_on_segment, Quadric, Simplifier, V3};
use crate::hlod::flatten::mesh::NONE;
use crate::hlod::flatten::sort::unstable_sort;
use trillion3d_math::heap::IndexedHeap;
use trillion3d_math::vector::vecn::{add, scale};

impl Simplifier {
    /// The boundary vertices.
    pub(super) fn precompute(&mut self) {
        self.have_boundary = false;
        self.boundary = vec![false; self.positions.len()];
        for e in 0..self.mesh.edges.len() {
            if self.mesh.is_edge(e) && self.mesh.is_boundary(e) {
                let [a, b] = self.mesh.ends(e);
                self.boundary[a] = true;
                self.boundary[b] = true;
                self.have_boundary = true;
            }
        }
    }

    fn face_quadric(&self, t: usize) -> (Quadric, f64) {
        let (n, area, centroid) = self.triangle_info(t);
        (Quadric::plane(n, centroid), area)
    }

    /// The area-weighted sum of the quadrics of the triangles about `v`.
    fn vertex_quadric(&self, v: usize) -> Quadric {
        let mut q = Quadric::default();
        for t in self.mesh.triangles_at(v) {
            q.add(self.tri_areas[t], &self.tri_quadrics[t]);
        }
        q
    }

    /// The edge's quadric: the two vertex quadrics, the edge's triangles counted once.
    fn edge_quadric(&self, e: usize) -> Quadric {
        let ([a, b], tris) = (self.mesh.ends(e), self.mesh.faces(e));
        let mut q = self.vertex_quadrics[a];
        q.add(1.0, &self.vertex_quadrics[b]);
        for t in tris {
            if t != NONE {
                q.add(-self.tri_areas[t], &self.tri_quadrics[t]);
            }
        }
        q
    }

    /// Edge `e`'s collapse point: on a boundary edge the best of its end, its midpoint and the
    /// optimum brought onto it; an edge touching the boundary collapses onto its boundary end; any
    /// other to the optimum, else the best of its end and its midpoint.
    fn optimal_point(&self, e: usize, q: &Quadric) -> V3 {
        let [a, b] = self.mesh.ends(e);
        let [pa, pb] = self.edge_points(e);
        let mut best = (pa, q.evaluate(pa));
        let mut consider = |p: V3| {
            let err = q.evaluate(p);
            if err < best.1 {
                best = (p, err);
            }
        };
        if self.have_boundary {
            if self.mesh.is_boundary(e) {
                consider(pb);
                consider(scale(add(pa, pb), 0.5));
                if let Some(x) = q.optimal() {
                    consider(nearest_on_segment(pa, pb, x));
                }
                return best.0;
            } else if self.boundary[a] {
                return pa;
            } else if self.boundary[b] {
                return pb;
            }
        }
        if let Some(x) = q.optimal() {
            return x;
        }
        consider(pb);
        consider(scale(add(pa, pb), 0.5));
        best.0
    }

    /// Edge `e`'s collapse point and its error.
    fn scored(&self, e: usize) -> (V3, f32) {
        let q = self.edge_quadric(e);
        let opt = self.optimal_point(e, &q);
        (opt, q.evaluate(opt) as f32)
    }

    fn score(&mut self, e: usize) -> f32 {
        let (opt, error) = self.scored(e);
        self.collapse_points[e] = opt;
        error
    }

    /// Each triangle's,
    /// each vertex's and each edge's computed side by side from what the step before made.
    pub(super) fn initialize(&mut self) {
        use rayon::prelude::*;
        let triangles = self.mesh.triangles.len();
        (self.tri_quadrics, self.tri_areas) = (0..triangles)
            .into_par_iter()
            .map(|t| {
                if self.mesh.is_triangle(t) {
                    self.face_quadric(t)
                } else {
                    (Quadric::default(), 0.0)
                }
            })
            .unzip();
        // A vertex that does not stand lists no edge, its quadric is the empty one.
        self.vertex_quadrics = (0..self.positions.len())
            .into_par_iter()
            .map(|v| self.vertex_quadric(v))
            .collect();
        let edges = self.mesh.edges.len();
        let scored: Vec<(V3, f32)> = (0..edges)
            .into_par_iter()
            .map(|e| {
                if self.mesh.is_edge(e) {
                    self.scored(e)
                } else {
                    ([0.0; 3], 0.0)
                }
            })
            .collect();
        self.marks = vec![0; edges];
        self.epoch = 0;
        // Every edge slot, a standing edge by its error and its id, any other by the largest error
        // and no id: the whole list sorted by error alone, equal errors left as the shared
        // unstable sort leaves them, then the standing edges inserted in that order.
        let mut errors: Vec<(f32, i32)> = (0..edges)
            .map(|e| match self.mesh.is_edge(e) {
                true => (scored[e].1, e as i32),
                false => (f32::MAX, -1),
            })
            .collect();
        self.collapse_points = scored.into_iter().map(|(point, _)| point).collect();
        unstable_sort(&mut errors, |x, y| x.0 < y.0);
        self.queue = IndexedHeap::new(edges);
        for (error, e) in errors.into_iter().filter(|&(_, e)| e >= 0) {
            self.queue.insert(e as u32, error);
        }
    }

    /// After a collapse, memoryless: the quadrics of the triangles about the kept vertex and
    /// of their vertices recomputed, the removed triangles taken from the opposing vertices, then
    /// every edge of the kept vertex and of its neighbours scored again.
    pub(super) fn update_neighborhood(
        &mut self,
        kept: usize,
        removed: [usize; 2],
        opposing: [usize; 2],
    ) {
        for t in self.mesh.triangles_at(kept) {
            let (old_area, old) = (self.tri_areas[t], self.tri_quadrics[t]);
            let (new, new_area) = self.face_quadric(t);
            self.tri_areas[t] = new_area;
            self.tri_quadrics[t] = new;
            for v in self.mesh.corners(t) {
                if v != kept {
                    let q = &mut self.vertex_quadrics[v];
                    q.add(-old_area, &old);
                    q.add(new_area, &new);
                }
            }
        }
        for k in 0..2 {
            let t = removed[k];
            if t != NONE {
                let (area, q) = (self.tri_areas[t], self.tri_quadrics[t]);
                self.vertex_quadrics[opposing[k]].add(-area, &q);
                self.tri_quadrics[t] = Quadric::default();
                self.tri_areas[t] = 0.0;
            }
        }
        self.vertex_quadrics[kept] = self.vertex_quadric(kept);
        // Each edge once, by a mark per edge: a vertex of a flat region gathers a wide fan.
        self.epoch += 1;
        let mut update: Vec<usize> = Vec::with_capacity(64);
        for adjacent in self.mesh.edges_at(kept) {
            update.push(adjacent);
            self.marks[adjacent] = self.epoch;
            let v = self.mesh.other(adjacent, kept);
            for e in self.mesh.edges_at(v) {
                if self.marks[e] != self.epoch {
                    self.marks[e] = self.epoch;
                    update.push(e);
                }
            }
        }
        for e in update {
            let error = self.score(e);
            self.queue.set(e as u32, error);
        }
    }
}
