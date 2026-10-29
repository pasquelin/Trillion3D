//! What collapsing an edge's ring leaves and costs. Each ring edge leaves its first end's vertex
//! (the loop writes it over the second end), and each other vertex of the two position rings its
//! own, all moved to one point: the
//! locked end's position when an end is locked (the first end's when both are), else the least of
//! the summed quadrics (`optimum`), else the ends' midpoint. Each moved vertex whose quadric covers
//! an area takes the normal the quadric gives the point, normalized. The cost sums each vertex's
//! quadric at its new self and the rings' boundary edges' planes at the unrounded point.
//!
//! The ring's price adds penalties: 100 for each triangle the two position rings hold past 24,
//! and ten million for each triangle the move turns over. An edge with both ends locked costs the
//! greatest float.
//!
//! The quadrics are cached: a triangle's from its corners, a vertex's as its triangles' sum, a
//! vertex's boundary as the sum over the vertices its triangles reach of the plane of the edge to
//! each one exactly one of its triangles borders, at 256 per unit of length.
use super::super::optimum::Optimum;
use super::super::quadric::{NormalQuadric, PlaneQuadric};
use super::super::Vertex;
use super::{Collapser, LOCKED, MARK};
use crate::hlod::flatten::simplify::nearest::{normalize, SMALL};
use smallvec::SmallVec;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// The weight of a boundary edge's plane per unit of its length.
const BOUNDARY_WEIGHT: f32 = 256.0;
/// The triangles a collapse's two position rings may hold before each one more costs
/// `DEGREE_PENALTY`.
const DEGREE_LIMIT: i32 = 24;
const DEGREE_PENALTY: f32 = 100.0;
/// The cost of each triangle a collapse turns over.
const FOLD_PENALTY: f32 = 1.0e7;
/// The summed area over which a quadric gives its point a normal.
const AREA_FOR_NORMAL: f64 = 1e-8;

/// The vertices a ring's collapse leaves, in the order `collapsed` lists them.
pub(super) type Collapsed = SmallVec<[Vertex; 16]>;

/// `a` times the reciprocal of its length when its squared length passes `SMALL`, else as it is.
fn unit_f32(mut a: [f32; 3]) -> [f32; 3] {
    normalize(&mut a, SMALL);
    a
}

impl Collapser {
    /// The sum of `v`'s triangles' quadrics, cached until a collapse touches it.
    fn vertex_quadric(&mut self, v: u32) -> NormalQuadric {
        if let Some(q) = self.vertex_quadrics[v as usize] {
            return q;
        }
        let mut sum = NormalQuadric::default();
        for at in 0..self.vertex_triangles[v as usize].len() {
            let t = self.vertex_triangles[v as usize][at];
            sum.add(&self.triangle_quadric(t));
        }
        self.vertex_quadrics[v as usize] = Some(sum);
        sum
    }

    /// `t`'s quadric, cached until a collapse touches it.
    fn triangle_quadric(&mut self, t: u32) -> NormalQuadric {
        if let Some(q) = self.triangle_quadrics[t as usize] {
            return q;
        }
        let corners = self.corners[t as usize];
        let q = NormalQuadric::of_triangle(
            corners.map(|v| self.position(v).map(f64::from)),
            corners.map(|v| self.vertices[v as usize].normal),
        );
        self.triangle_quadrics[t as usize] = Some(q);
        q
    }

    /// The planes of the boundary edges from `v`, cached until a collapse touches it: an edge to a
    /// vertex `v`'s triangles reach is a boundary when exactly one of them holds that vertex too.
    fn boundary_quadric(&mut self, v: u32) -> PlaneQuadric {
        if let Some(q) = self.boundary_quadrics[v as usize] {
            return q;
        }
        let mut sum = PlaneQuadric::default();
        let around = self.around(v);
        self.mark_triangles(v, MARK, true);
        for w in around {
            let mut shared = (self.vertex_triangles[w as usize].iter())
                .copied()
                .filter(|&t| self.triangle_has(t, MARK));
            if let (Some(face), None) = (shared.next(), shared.next()) {
                let edge = PlaneQuadric::of_edge(
                    self.position(v).map(f64::from),
                    self.position(w).map(f64::from),
                    self.triangle_normal(face).map(f64::from),
                    BOUNDARY_WEIGHT,
                );
                sum.add(&edge);
            }
        }
        self.mark_triangles(v, MARK, false);
        self.boundary_quadrics[v as usize] = Some(sum);
        sum
    }

    /// `t`'s unit normal in single precision, `(p₂ − p₀) × (p₁ − p₀)` normalized when long enough.
    fn triangle_normal(&self, t: u32) -> [f32; 3] {
        let [p0, p1, p2] = self.corners[t as usize].map(|v| self.position(v));
        unit_f32(cross(sub(p2, p0), sub(p1, p0)))
    }

    /// Whether `t` keeps its side when its corner `old` moves to `point`: the normals of the
    /// triangle and of the moved one, both on the opposite side, point the same way.
    fn keeps_facing(&self, t: u32, old: u32, point: [f32; 3]) -> bool {
        let corners = self.corners[t as usize];
        let k = if old == corners[0] {
            0
        } else if old == corners[1] {
            1
        } else {
            2
        };
        let [p0, p1, p2] = [k, (k + 1) % 3, (k + 2) % 3].map(|i| self.position(corners[i]));
        let side = sub(p2, p1);
        let before = cross(sub(p0, p1), side);
        let after = cross(sub(point, p1), side);
        dot(before, after) > 0.0
    }

    /// The vertices collapsing `edge`'s ring leaves and the cost of their quadrics: the ring
    /// edges' first, then the rest of the first end's position ring, then of the second's.
    pub(super) fn collapsed(&mut self, edge: u32) -> (Collapsed, f32) {
        let [u, v] = self.edges[edge as usize].ends;
        let mut optimum = Optimum::default();
        let mut vertices = Collapsed::new();
        let mut quadrics: SmallVec<[NormalQuadric; 16]> = SmallVec::new();
        self.mark_ring(u, MARK, true);
        self.mark_ring(v, MARK, true);
        for e in self.edge_ring(edge) {
            let [a, b] = self.edges[e as usize].ends;
            vertices.push(self.vertices[a as usize]);
            let mut q = self.vertex_quadric(a);
            q.add(&self.vertex_quadric(b));
            optimum.add_normal(&q);
            quadrics.push(q);
            self.mark_vertex(a, MARK, false);
            self.mark_vertex(b, MARK, false);
        }
        let rings = self.joint_ring(u, v);
        for &w in &rings {
            if self.vertex_has(w, MARK) {
                vertices.push(self.vertices[w as usize]);
                let q = self.vertex_quadric(w);
                optimum.add_normal(&q);
                quadrics.push(q);
                self.mark_vertex(w, MARK, false);
            }
        }
        let mut boundary = PlaneQuadric::default();
        for &w in &rings {
            boundary.add(&self.boundary_quadric(w));
        }
        optimum.add_plane(&boundary);
        let (pu, pv) = (self.position(u), self.position(v));
        let point = if self.vertex_has(u, LOCKED) {
            pu.map(f64::from)
        } else if self.vertex_has(v, LOCKED) {
            pv.map(f64::from)
        } else {
            optimum
                .solve()
                .unwrap_or_else(|| scale(add(pu, pv).map(f64::from), 0.5))
        };
        let rounded = point.map(|x| x as f32);
        let at = rounded.map(f64::from);
        let mut cost = 0.0f32;
        for (vertex, q) in vertices.iter_mut().zip(&quadrics) {
            vertex.position = rounded;
            if q.area > AREA_FOR_NORMAL {
                vertex.normal = unit_f32(q.normal_at(at));
            }
            cost += q.error_at(at, vertex.normal);
        }
        cost += boundary.error_at(point);
        (vertices, cost)
    }

    /// The price of collapsing `edge`'s ring: its quadrics' cost and penalties.
    pub(super) fn collapse_cost(&mut self, edge: u32) -> f32 {
        let [u, v] = self.edges[edge as usize].ends;
        if self.vertex_has(u, LOCKED) && self.vertex_has(v, LOCKED) {
            return f32::MAX;
        }
        let (vertices, cost) = self.collapsed(edge);
        let point = vertices[0].position;
        let (ring_u, ring_v) = (self.vertex_ring(u), self.vertex_ring(v));
        let degree: i32 = (ring_u.iter().chain(&ring_v))
            .map(|&w| self.vertex_triangles[w as usize].len() as i32)
            .sum();
        let mut penalty = 0.0f32;
        if degree > DEGREE_LIMIT {
            penalty += DEGREE_PENALTY * (degree - DEGREE_LIMIT) as f32;
        }
        // The second end's triangles are marked: the first ring tests those it does not share,
        // the second those the first ring has not cleared.
        self.mark_ring_triangles(v, MARK, true);
        for (ring, shared) in [(ring_u, false), (ring_v, true)] {
            for w in ring {
                for at in 0..self.vertex_triangles[w as usize].len() {
                    let t = self.vertex_triangles[w as usize][at];
                    if self.triangle_has(t, MARK) == shared && !self.keeps_facing(t, w, point) {
                        penalty += FOLD_PENALTY;
                    }
                    self.mark_triangle(t, MARK, false);
                }
            }
        }
        cost + penalty
    }
}
