//! The quadrics: the optimal point, the score, their set-up and neighbourhood.
use super::super::heap::Heap;
use super::{nearest_on_segment, Quadric, Simplifier, NONE, V3};
use trillion3d_math::vecn::{add, scale};

impl Simplifier {
    /// The boundary vertices.
    pub(super) fn precompute(&mut self) {
        self.have_boundary = false;
        self.boundary = vec![false; self.mesh.positions.len()];
        for e in 0..self.mesh.edges.len() {
            if self.mesh.edge_alive[e] && self.mesh.boundary_edge(e as u32) {
                let [a, b] = self.mesh.edges[e].0;
                self.boundary[a as usize] = true;
                self.boundary[b as usize] = true;
                self.have_boundary = true;
            }
        }
    }

    fn face_quadric(&self, t: u32) -> (Quadric, f64) {
        let (n, area, centroid) = self.mesh.triangle_info(t);
        (Quadric::plane(n, centroid), area)
    }

    /// The area-weighted sum of the quadrics of the triangles about `v`.
    fn vertex_quadric(&self, v: u32) -> Quadric {
        let mut q = Quadric::default();
        for t in self.mesh.vertex_triangles(v) {
            q.add(self.tri_areas[t as usize], &self.tri_quadrics[t as usize]);
        }
        q
    }

    /// The edge's quadric: the two vertex quadrics, the edge's triangles counted once.
    fn edge_quadric(&self, e: u32) -> Quadric {
        let ([a, b], tris) = self.mesh.edges[e as usize];
        let mut q = self.vertex_quadrics[a as usize];
        q.add(1.0, &self.vertex_quadrics[b as usize]);
        for t in tris {
            if t != NONE {
                q.add(-self.tri_areas[t as usize], &self.tri_quadrics[t as usize]);
            }
        }
        q
    }

    /// Edge `e`'s collapse point: on a boundary edge the best of its end, its midpoint and the
    /// optimum brought onto it; an edge touching the boundary collapses onto its boundary end; any
    /// other to the optimum, else the best of its end and its midpoint.
    fn optimal_point(&self, e: u32, q: &Quadric) -> V3 {
        let [a, b] = self.mesh.edges[e as usize].0;
        let (pa, pb) = (
            self.mesh.positions[a as usize],
            self.mesh.positions[b as usize],
        );
        let mut best = (pa, q.evaluate(pa));
        let mut consider = |p: V3| {
            let err = q.evaluate(p);
            if err < best.1 {
                best = (p, err);
            }
        };
        if self.have_boundary {
            if self.mesh.boundary_edge(e) {
                consider(pb);
                consider(scale(add(pa, pb), 0.5));
                if let Some(x) = q.optimal() {
                    consider(nearest_on_segment(pa, pb, x));
                }
                return best.0;
            } else if self.boundary[a as usize] {
                return pa;
            } else if self.boundary[b as usize] {
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
    fn scored(&self, e: u32) -> (V3, f32) {
        let q = self.edge_quadric(e);
        let opt = self.optimal_point(e, &q);
        (opt, q.evaluate(opt) as f32)
    }

    fn score(&mut self, e: u32) -> f32 {
        let (opt, error) = self.scored(e);
        self.collapse_points[e as usize] = opt;
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
                if self.mesh.triangle_alive[t] {
                    self.face_quadric(t as u32)
                } else {
                    (Quadric::default(), 0.0)
                }
            })
            .unzip();
        self.vertex_quadrics = (0..self.mesh.positions.len())
            .into_par_iter()
            .map(|v| {
                if self.mesh.vertex_alive[v] {
                    self.vertex_quadric(v as u32)
                } else {
                    Quadric::default()
                }
            })
            .collect();
        let edges = self.mesh.edges.len();
        let scored: Vec<(V3, f32)> = (0..edges as u32)
            .into_par_iter()
            .map(|e| {
                if self.mesh.edge_alive[e as usize] {
                    self.scored(e)
                } else {
                    ([0.0; 3], 0.0)
                }
            })
            .collect();
        self.marks = vec![0; edges];
        self.epoch = 0;
        let mut errors: Vec<(f32, u32)> = (0..edges as u32)
            .filter(|&e| self.mesh.edge_alive[e as usize])
            .map(|e| (scored[e as usize].1, e))
            .collect();
        self.collapse_points = scored.into_iter().map(|(point, _)| point).collect();
        errors.par_sort_unstable_by(|x, y| x.0.total_cmp(&y.0).then(x.1.cmp(&y.1)));
        self.queue = Heap::new(edges);
        for (error, e) in errors {
            self.queue.insert(e, error);
        }
    }

    /// After a collapse, memoryless: the quadrics of the triangles about the kept vertex and
    /// of their vertices recomputed, the removed triangles taken from the opposing vertices, then
    /// every edge of the kept vertex and of its neighbours scored again.
    pub(super) fn update_neighborhood(&mut self, kept: u32, removed: [u32; 2], opposing: [u32; 2]) {
        for t in self.mesh.vertex_triangles(kept) {
            let (old_area, old) = (self.tri_areas[t as usize], self.tri_quadrics[t as usize]);
            let (new, new_area) = self.face_quadric(t);
            self.tri_areas[t as usize] = new_area;
            self.tri_quadrics[t as usize] = new;
            for v in self.mesh.triangles[t as usize] {
                if v != kept {
                    let q = &mut self.vertex_quadrics[v as usize];
                    q.add(-old_area, &old);
                    q.add(new_area, &new);
                }
            }
        }
        for k in 0..2 {
            let t = removed[k];
            if t != NONE {
                let (area, q) = (self.tri_areas[t as usize], self.tri_quadrics[t as usize]);
                self.vertex_quadrics[opposing[k] as usize].add(-area, &q);
                self.tri_quadrics[t as usize] = Quadric::default();
                self.tri_areas[t as usize] = 0.0;
            }
        }
        self.vertex_quadrics[kept as usize] = self.vertex_quadric(kept);
        // Each edge once, by a mark per edge: a vertex of a flat region gathers a wide fan.
        self.epoch += 1;
        let mut update: Vec<u32> = Vec::with_capacity(64);
        for &adjacent in &self.mesh.vertex_edges[kept as usize] {
            update.push(adjacent);
            self.marks[adjacent as usize] = self.epoch;
            let v = self.mesh.other(adjacent, kept);
            for &e in &self.mesh.vertex_edges[v as usize] {
                if self.marks[e as usize] != self.epoch {
                    self.marks[e as usize] = self.epoch;
                    update.push(e);
                }
            }
        }
        for e in update {
            let error = self.score(e);
            self.queue.set(e, error);
        }
    }
}
