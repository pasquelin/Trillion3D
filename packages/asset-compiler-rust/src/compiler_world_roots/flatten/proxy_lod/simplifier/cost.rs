//! The quadrics of a collapse, its position, whether it is valid, and its cost.
use super::super::super::quadric::Plane;
use super::attributes::{edge_quadric, finite_cost, wide, QuadricAttr};
use super::optimizer::Optimizer;
use super::{
    unit_or_kept, Simplifier, Vertex, DEGREE_LIMIT, DEGREE_PENALTY, INVALID_PENALTY, LOCKED, MARK1,
};
use trillion3d_math::triangle::facing;
use trillion3d_math::vec3::cross;
use trillion3d_math::vecn::sub;

impl Simplifier {
    /// `v`'s quadric: the sum of its triangles' quadrics, each and the sum cached until a collapse
    /// touches them.
    pub(super) fn quadric(&mut self, v: u32) -> QuadricAttr {
        if let Some(q) = self.vert_quadrics[v as usize] {
            return q;
        }
        let mut sum = QuadricAttr::default();
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k] as usize;
            let q = match self.tri_quadrics[t] {
                Some(q) => q,
                None => {
                    let tri = self.tris[t].verts.map(|u| self.verts[u as usize].vert);
                    let q = QuadricAttr::new(tri.map(|u| wide(u.pos)), tri.map(|u| u.normal));
                    self.tri_quadrics[t] = Some(q);
                    q
                }
            };
            sum.add(&q);
        }
        self.vert_quadrics[v as usize] = Some(sum);
        sum
    }

    /// The unit normal of triangle `t`.
    fn tri_normal(&self, t: usize) -> [f32; 3] {
        let [a, b, c] = self.tris[t].verts.map(|u| self.verts[u as usize].vert.pos);
        unit_or_kept(cross(sub(c, a), sub(b, a)))
    }

    /// The boundary edge quadrics around `v` (its edges one face alone touches), cached.
    pub(super) fn edge_quadric(&mut self, v: u32) -> Plane {
        if let Some(q) = self.edge_quadrics[v as usize] {
            return q;
        }
        let mut sum = Plane::default();
        let adj = self.adjacent_verts(v);
        self.set_adj_tri_flags(v, MARK1, true);
        for u in adj {
            let mut face = None;
            let mut count = 0;
            for &t in &self.verts[u as usize].adj {
                if self.tris[t as usize].flags & MARK1 == MARK1 {
                    face = Some(t);
                    count += 1;
                }
            }
            if count == 1 {
                let normal = self.tri_normal(face.expect("a face") as usize);
                sum.add(&edge_quadric(
                    wide(self.verts[v as usize].vert.pos),
                    wide(self.verts[u as usize].vert.pos),
                    wide(normal),
                    256.0,
                ));
            }
        }
        self.set_adj_tri_flags(v, MARK1, false);
        self.edge_quadrics[v as usize] = Some(sum);
        sum
    }

    /// The collapse of `edge`'s group: the merged vertices, their quadrics, the boundary quadric
    /// and the optimal position.
    fn new_verts_pos(&mut self, edge: u32) -> (Vec<Vertex>, Vec<QuadricAttr>, Plane, [f64; 3]) {
        let mut optimizer = Optimizer::default();
        let mut new_verts = Vec::new();
        let mut quadrics = Vec::new();
        let (v0, v1) = (self.edges[edge as usize].v0, self.edges[edge as usize].v1);
        self.enable_group(v0, MARK1);
        self.enable_group(v1, MARK1);
        let mut e = edge;
        loop {
            let (a, b) = (self.edges[e as usize].v0, self.edges[e as usize].v1);
            new_verts.push(self.verts[a as usize].vert);
            let mut q = self.quadric(a);
            q.add(&self.quadric(b));
            quadrics.push(q);
            optimizer.add_attr(&q);
            self.verts[a as usize].flags &= !MARK1;
            self.verts[b as usize].flags &= !MARK1;
            e = self.edges[e as usize].next;
            if e == edge {
                break;
            }
        }
        for start in [v0, v1] {
            for v in self.group(start) {
                if self.test(v, MARK1) {
                    new_verts.push(self.verts[v as usize].vert);
                    let q = self.quadric(v);
                    quadrics.push(q);
                    optimizer.add_attr(&q);
                    self.verts[v as usize].flags &= !MARK1;
                }
            }
        }
        let mut edge_quadric = Plane::default();
        for start in [v0, v1] {
            for v in self.group(start) {
                let q = self.edge_quadric(v);
                edge_quadric.add(&q);
            }
        }
        optimizer.plane.add(&edge_quadric);
        let pos = if self.test(v0, LOCKED) {
            wide(self.verts[v0 as usize].vert.pos)
        } else if self.test(v1, LOCKED) {
            wide(self.verts[v1 as usize].vert.pos)
        } else {
            optimizer.optimize().unwrap_or_else(|| {
                let (a, b) = (
                    self.verts[v0 as usize].vert.pos,
                    self.verts[v1 as usize].vert.pos,
                );
                [a[0] + b[0], a[1] + b[1], a[2] + b[2]].map(|c| f64::from(c) * 0.5)
            })
        };
        (new_verts, quadrics, edge_quadric, pos)
    }

    /// The collapse of `edge`'s group priced: the merged vertices at the new position, normals
    /// from their quadrics, and the cost.
    pub(super) fn new_verts(&mut self, edge: u32) -> (Vec<Vertex>, f32) {
        let (mut new_verts, quadrics, edge_quadric, pos) = self.new_verts_pos(edge);
        let mut cost = 0.0f32;
        for (vert, q) in new_verts.iter_mut().zip(&quadrics) {
            vert.pos = pos.map(|c| c as f32);
            if q.area > 1e-8 {
                vert.normal = unit_or_kept(q.attributes(wide(vert.pos)));
            }
            cost += q.evaluate(wide(vert.pos), vert.normal);
        }
        cost += finite_cost(edge_quadric.evaluate(pos));
        (new_verts, cost)
    }

    /// Whether moving `old_v` to `pos` keeps the triangle facing the same side (`facing`, the
    /// triangle walked from the corner after `old_v`).
    fn replace_is_valid(&self, t: usize, old_v: u32, pos: [f32; 3]) -> bool {
        let verts = self.tris[t].verts;
        let k = (0..2).find(|&k| verts[k] == old_v).unwrap_or(2);
        let corner = |i: usize| self.verts[verts[(k + i) % 3] as usize].vert.pos;
        facing([corner(1), corner(2), corner(0)], 2, pos) > 0.0
    }

    /// The cost of collapsing `edge`: the quadric cost plus the degree and fold penalties; locked
    /// at both ends, the largest float.
    pub(super) fn collapse_cost(&mut self, edge: u32) -> f32 {
        let (u, v) = (self.edges[edge as usize].v0, self.edges[edge as usize].v1);
        if self.test(u, LOCKED) && self.test(v, LOCKED) {
            return f32::MAX;
        }
        let (new_verts, cost) = self.new_verts(edge);
        let new_pos = new_verts[0].pos;
        let mut penalty = 0.0f32;
        let degree: usize = self
            .group(u)
            .iter()
            .chain(self.group(v).iter())
            .map(|&w| self.verts[w as usize].adj.len())
            .sum();
        if degree > DEGREE_LIMIT {
            penalty += DEGREE_PENALTY * (degree - DEGREE_LIMIT) as f32;
        }
        self.set_adj_tri_flags_group(v, MARK1, true);
        for (start, marked) in [(u, false), (v, true)] {
            for w in self.group(start) {
                for k in 0..self.verts[w as usize].adj.len() {
                    let t = self.verts[w as usize].adj[k] as usize;
                    if (self.tris[t].flags & MARK1 == MARK1) == marked
                        && !self.replace_is_valid(t, w, new_pos)
                    {
                        penalty += INVALID_PENALTY;
                    }
                    self.tris[t].flags &= !MARK1;
                }
            }
        }
        cost + penalty
    }
}
