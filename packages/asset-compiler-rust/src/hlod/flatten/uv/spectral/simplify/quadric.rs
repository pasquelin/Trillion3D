//! The quadrics of the simplification and the cost of each edge.
//!
//! The chart's diagonal is first measured on its own vertices. Each face gives the quadric of its
//! plane, `n nᵀ`, `d n`, `d²` with `d = −n·p` for its first corner `p`, its products in double
//! precision; each boundary edge the quadric of the plane through it along its face's normal,
//! whose matrix products are taken in single precision. A vertex sums the quadrics of its planes.
//! An edge sums its two vertices' quadrics less the planes they share, and costs the error at the
//! end it keeps: the boundary end when only one is on the boundary, else the cheaper end, the
//! first kept on a tie. The cost is the error's square root, zero for a negative error.
//!
//! The vector steps round as the library's: each difference, cross product and dot product is
//! taken in double precision and rounded to single.
use super::{Quadric, Simplifier};
use crate::hlod::flatten::uv::spectral::util::{root64, unit};
use trillion3d_math::vector::vecn::{length, sub};

/// `a − b`, each axis in double precision rounded to single.
pub(super) fn difference(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [0, 1, 2].map(|i| (a[i] as f64 - b[i] as f64) as f32)
}

/// `a × b`, each axis in double precision rounded to single.
pub(super) fn cross_wide(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    let w = |x: f32| x as f64;
    [
        (w(a[1]) * w(b[2]) - w(a[2]) * w(b[1])) as f32,
        (w(a[2]) * w(b[0]) - w(a[0]) * w(b[2])) as f32,
        (w(a[0]) * w(b[1]) - w(a[1]) * w(b[0])) as f32,
    ]
}

/// `a · b` in double precision rounded to single.
pub(super) fn dot_wide(a: [f32; 3], b: [f32; 3]) -> f32 {
    (a[0] as f64 * b[0] as f64 + a[1] as f64 * b[1] as f64 + a[2] as f64 * b[2] as f64) as f32
}

/// The longest plane list searched in place: a longer one is searched sorted.
const SEARCHED: usize = 32;

/// The planes of `a` that `b` holds too, in `a`'s order. A vertex that took the planes of many
/// collapsed ones holds hundreds, so a long `b` is searched sorted rather than once per plane of `a`.
fn shared_planes(a: &[u32], b: &[u32]) -> Vec<u32> {
    if b.len() <= SEARCHED {
        return a.iter().copied().filter(|s| b.contains(s)).collect();
    }
    let mut sorted = b.to_vec();
    sorted.sort_unstable();
    (a.iter().copied())
        .filter(|s| sorted.binary_search(s).is_ok())
        .collect()
}

/// The error of quadric `q` at `p`.
fn error_at(q: &Quadric, p: [f32; 3]) -> f64 {
    let mut ap = [0f64; 3];
    for i in 0..3 {
        for j in 0..3 {
            ap[i] += p[j] as f64 * q.a[i][j];
        }
    }
    let mut error = 0.0;
    for i in 0..3 {
        error += ap[i] * p[i] as f64;
    }
    for i in 0..3 {
        error += 2.0 * q.b[i] * p[i] as f64;
    }
    error + q.c
}

impl<'s> Simplifier<'s> {
    /// The diagonal, the quadrics, the vertices' errors and the edges' costs.
    pub(super) fn measure(&mut self) {
        let mut low = [f32::MAX; 3];
        let mut high = [-f32::MAX; 3];
        for v in 0..self.verts.len() as u32 {
            let p = self.point(v);
            for j in 0..3 {
                if low[j] > p[j] {
                    low[j] = p[j];
                }
                if high[j] < p[j] {
                    high[j] = p[j];
                }
            }
        }
        self.diagonal = length(sub(high, low));
        self.plane_quadrics();
        for v in 0..self.verts.len() {
            self.vertex_error(v);
        }
        for e in 0..self.edges.len() {
            self.edge_cost(e);
        }
    }

    /// One quadric per face, then one per boundary edge, each listed by the vertices it touches.
    fn plane_quadrics(&mut self) {
        let mut quadrics = Vec::new();
        for f in 0..self.faces.len() {
            let face = &self.faces[f];
            let n = face.normal;
            let d = -(dot_wide(n, self.point(face.verts[0])) as f64);
            let w = |x: f32| x as f64;
            let mut q = Quadric::default();
            q.a[0][0] = w(n[0]) * w(n[0]);
            q.a[1][1] = w(n[1]) * w(n[1]);
            q.a[2][2] = w(n[2]) * w(n[2]);
            q.a[0][1] = w(n[0]) * w(n[1]);
            q.a[0][2] = w(n[0]) * w(n[2]);
            q.a[1][2] = w(n[1]) * w(n[2]);
            q.a[1][0] = q.a[0][1];
            q.a[2][0] = q.a[0][2];
            q.a[2][1] = q.a[1][2];
            q.b = [0, 1, 2].map(|i| w(n[i]) * d);
            q.c = d * d;
            let id = quadrics.len() as u32;
            for k in 0..3 {
                let v = self.faces[f].verts[k];
                self.verts[v as usize].quadrics.push(id);
            }
            quadrics.push(q);
        }
        for e in 0..self.edges.len() {
            if !self.edges[e].boundary {
                continue;
            }
            let edge = &self.edges[e];
            let along = difference(self.point(edge.verts[1]), self.point(edge.verts[0]));
            let n = unit(cross_wide(along, self.faces[edge.faces[0] as usize].normal));
            let d = -(dot_wide(n, self.point(edge.verts[0])) as f64);
            let mut q = Quadric::default();
            for i in 0..3 {
                for j in 0..3 {
                    q.a[i][j] = (n[i] * n[j]) as f64;
                }
            }
            q.b = [0, 1, 2].map(|i| n[i] as f64 * d);
            q.c = d * d;
            let id = quadrics.len() as u32;
            for k in 0..2 {
                let v = self.edges[e].verts[k];
                self.verts[v as usize].quadrics.push(id);
            }
            quadrics.push(q);
        }
        self.quadrics = quadrics;
    }

    /// Vertex `v`'s quadric: the sum of its planes', in list order.
    pub(super) fn vertex_error(&mut self, v: usize) {
        let mut sum = Quadric::default();
        for &q in &self.verts[v].quadrics {
            let q = &self.quadrics[q as usize];
            for j in 0..3 {
                for k in 0..3 {
                    sum.a[j][k] += q.a[j][k];
                }
                sum.b[j] += q.b[j];
            }
            sum.c += q.c;
        }
        self.verts[v].error = sum;
    }

    /// Edge `e`'s cost and the end it removes.
    pub(super) fn edge_cost(&mut self, e: usize) {
        let [a, b] = self.edges[e].verts;
        let (va, vb) = (&self.verts[a as usize], &self.verts[b as usize]);
        let mut q = Quadric::default();
        for i in 0..3 {
            for j in 0..3 {
                q.a[i][j] = va.error.a[i][j] + vb.error.a[i][j];
            }
            q.b[i] = va.error.b[i] + vb.error.b[i];
        }
        q.c = va.error.c + vb.error.c;
        for shared in shared_planes(&va.quadrics, &vb.quadrics) {
            let p = &self.quadrics[shared as usize];
            for k in 0..3 {
                for j in 0..3 {
                    q.a[k][j] -= p.a[k][j];
                }
                q.b[k] -= p.b[k];
            }
            q.c -= p.c;
        }
        let (pa, pb) = (self.point(a), self.point(b));
        let (cost, removes) = if va.boundary && !vb.boundary {
            (error_at(&q, pa), 1)
        } else if vb.boundary && !va.boundary {
            (error_at(&q, pb), 0)
        } else {
            let keep_a = error_at(&q, pa);
            let keep_b = error_at(&q, pb);
            if keep_a > keep_b {
                (keep_b, 0)
            } else {
                (keep_a, 1)
            }
        };
        let edge = &mut self.edges[e];
        edge.removes = removes;
        edge.cost = if cost < 0.0 { 0.0 } else { root64(cost) };
    }
}
