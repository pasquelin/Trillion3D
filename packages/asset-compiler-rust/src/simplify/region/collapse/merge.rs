//! A collapse: its cost, where it puts the merged position and the attributes each wedge takes
//! there, and the edges it makes under the edge length bound; made, it moves every vertex there
//! (`moves.rs`).
use super::{
    about, attributes, Simplifier, ADJ_TRI, DEGREE_LIMIT, DEGREE_PENALTY, INVERSION_PENALTY,
    LOCKED, LOCK_PENALTY, MERGE_MASK, P,
};
use crate::simplify::region::quadric::{self, Optimizer, PositionQuadric};
use trillion3d_math::geometry::aabb::extend_aabb_f32;
use trillion3d_math::join::{GreatestRoot, Join};
use trillion3d_math::vector::vecn::{add, distance2};

/// A vertex at one of the pair's positions and the gathered triangle it was met in.
#[derive(Clone, Copy)]
struct WedgeVert {
    vert: u32,
    adj: usize,
}

/// What one evaluation gathers, kept between evaluations so they allocate nothing once grown.
#[derive(Default)]
pub(crate) struct Scratch {
    /// The live triangles at either position, in the order met.
    pub(crate) adj_tris: Vec<usize>,
    /// Per position, its vertices and the triangle each was first met in.
    wedge_verts: [Vec<WedgeVert>; 2],
    /// The union of the gathered triangles into wedges, by their rank in `adj_tris`.
    parents: Join<GreatestRoot>,
    /// Per gathered triangle, its wedge; per wedge, its union root, quadric and attributes.
    pub(crate) wedge_of: Vec<usize>,
    wedge_ids: Vec<u32>,
    pub(crate) wedge_quadrics: Vec<f64>,
    pub(crate) wedge_values: Vec<f32>,
}

impl Simplifier {
    /// The cost of merging positions `p0` and `p1`, penalties included unless the merge is made
    /// (`move_verts`), when it returns the error made.
    pub(crate) fn evaluate_merge(&mut self, p0: P, p1: P, move_verts: bool) -> f32 {
        if p0 == p1 {
            return 0.0;
        }
        let mut s = std::mem::take(&mut self.scratch);
        let error = self.merge_with(&mut s, p0, p1, move_verts);
        self.scratch = s;
        error
    }

    fn merge_with(&mut self, s: &mut Scratch, p0: P, p1: P, move_verts: bool) -> f32 {
        s.adj_tris.clear();
        s.parents.clear();
        s.wedge_verts.iter_mut().for_each(Vec::clear);
        let mut degree = 0i32;
        let mut flags_union = [0u8; 2];
        for (index, p) in [p0, p1].into_iter().enumerate() {
            for &corner in self.corner_hash.at(p).iter().rev() {
                let corner = corner as usize;
                degree += 1;
                flags_union[index] |= self.corner_flags[corner];
                self.corner_flags[corner] |= 1 << index;
                let tri = corner / 3;
                let first = &mut self.corner_flags[tri * 3];
                let adj = if *first & ADJ_TRI == 0 {
                    *first |= ADJ_TRI;
                    s.adj_tris.push(tri);
                    s.parents.push() as usize
                } else {
                    let at = s.adj_tris.iter().position(|&t| t == tri);
                    at.expect("a gathered triangle")
                };
                let vert = self.indexes[corner];
                match s.wedge_verts[index].iter().find(|w| w.vert == vert) {
                    None => s.wedge_verts[index].push(WedgeVert { vert, adj }),
                    Some(other) => s.parents.unite(adj as u32, other.adj as u32),
                }
            }
        }
        if degree == 0 {
            return 0.0;
        }
        // Collapsing it would remove every triangle left.
        if degree as usize == self.remaining_tris * 2 {
            self.clear_flags(&s.adj_tris);
            return 0.0;
        }
        let locked = [flags_union[0] & LOCKED != 0, flags_union[1] & LOCKED != 0];
        let mut penalty = 0.0_f32;
        if degree > DEGREE_LIMIT {
            penalty += DEGREE_PENALTY * (degree - DEGREE_LIMIT) as f32;
        }
        // Per wedge, its quadric: its triangles' summed about `p0`.
        let m = self.m;
        let size = quadric::size(m);
        s.wedge_of.clear();
        s.wedge_ids.clear();
        s.wedge_quadrics.clear();
        for (adj, &tri) in s.adj_tris.iter().enumerate() {
            let id = s.parents.root(adj as u32);
            let corner0 = self.indexes[tri * 3];
            let point = about(self.position(corner0), p0);
            let values = attributes(&self.verts, m, corner0);
            let q = self.quadric(tri);
            match s.wedge_ids.iter().position(|&w| w == id) {
                Some(w) => {
                    let into = &mut s.wedge_quadrics[w * size..(w + 1) * size];
                    quadric::add_about(into, q, point, values, &self.weights);
                    s.wedge_of.push(w);
                }
                None => {
                    s.wedge_of.push(s.wedge_ids.len());
                    s.wedge_ids.push(id);
                    let at = s.wedge_quadrics.len();
                    s.wedge_quadrics.extend_from_slice(q);
                    let into = &mut s.wedge_quadrics[at..at + size];
                    quadric::rebase(into, point, values, &self.weights);
                }
            }
        }
        let wedges = s.wedge_ids.len();
        let mut optimizer = Optimizer::default();
        for w in 0..wedges {
            optimizer.add_quadric(&s.wedge_quadrics[w * size..(w + 1) * size], m);
        }
        let (mut low, mut high) = ([f32::MAX; 3], [-f32::MAX; 3]);
        let mut edges = PositionQuadric::default();
        for &tri in &s.adj_tris {
            for k in 0..3 {
                let corner = tri * 3 + k;
                let p = self.position(self.indexes[corner]);
                extend_aabb_f32(&mut low, &mut high, p);
                let next = tri * 3 + ((1 << k) & 3);
                let flags = self.corner_flags[corner] | self.corner_flags[next];
                if self.edge_valid[corner] && flags & MERGE_MASK != 0 {
                    edges.add_edge(&self.edge_quadrics[corner], about(p, p0));
                }
            }
        }
        optimizer.add_edges(&edges);
        let adj_tris = &s.adj_tris;
        let valid = |simplifier: &Self, p: P| -> bool {
            // Near the neighbourhood: within twice its box's diagonal.
            let outside: f32 = (0..3)
                .map(|a| (low[a] - p[a]).max(0.0).max(p[a] - high[a]).powi(2))
                .sum();
            if outside > distance2(high, low) * 4.0 {
                return false;
            }
            !adj_tris.iter().any(|&t| simplifier.tri_will_invert(t, p))
        };
        let plus = |q: quadric::V3| -> P { add(q.map(|x| x as f32), p0) };
        let new_position = match locked {
            [true, true] | [false, false] => {
                if locked[0] {
                    penalty += LOCK_PENALTY;
                }
                // The first valid of the three, each solved only when the ones before it fail.
                let usable = |p: Option<quadric::V3>| p.map(plus).filter(|&p| valid(self, p));
                let found = usable(optimizer.optimize_volume())
                    .or_else(|| usable(optimizer.optimize()))
                    .or_else(|| usable(optimizer.optimize_linear([0.0; 3], about(p1, p0))));
                match found {
                    Some(p) => p,
                    None => {
                        let middle = [0, 1, 2].map(|a| (p0[a] + p1[a]) * 0.5);
                        if !valid(self, middle) {
                            penalty += INVERSION_PENALTY;
                        }
                        middle
                    }
                }
            }
            [kept0, _] => {
                let p = if kept0 { p0 } else { p1 };
                if !valid(self, p) {
                    penalty += INVERSION_PENALTY;
                }
                p
            }
        };
        let rebased = about(new_position, p0);
        // Per wedge, the attributes its vertices take.
        s.wedge_values.clear();
        s.wedge_values.resize(wedges * m, 0.0);
        let one_locked = locked[0] != locked[1];
        if one_locked || self.zero_weights {
            let farthest = if distance2(new_position, p0) > distance2(new_position, p1) {
                0
            } else {
                1
            };
            for j in 0..2 {
                for wv in &s.wedge_verts[(farthest + j) & 1] {
                    let w = s.wedge_of[wv.adj];
                    let values = attributes(&self.verts, m, wv.vert);
                    s.wedge_values[w * m..(w + 1) * m].copy_from_slice(values);
                }
            }
        }
        let edge_error = edges.evaluate(rebased);
        let mut error = 0.0_f32;
        let mut surface = 0.0_f32;
        for w in 0..wedges {
            let q = &s.wedge_quadrics[w * size..(w + 1) * size];
            let values = &mut s.wedge_values[w * m..(w + 1) * m];
            let area = q[quadric::AREA];
            if area > 1e-8 {
                let wedge_error = if one_locked {
                    quadric::evaluate(q, rebased, values, &self.weights)
                } else {
                    let e = quadric::solve_and_evaluate(q, rebased, values, &self.weights);
                    self.corrected.apply(values);
                    e
                };
                error += f64::from(wedge_error).min(area) as f32;
            } else {
                values.fill(0.0);
            }
            surface = (f64::from(surface) + area) as f32;
        }
        error += edge_error;
        error = error.min(surface);
        let disjoint = s.adj_tris.len() == 1 || (s.adj_tris.len() == 2 && degree == 4);
        if disjoint {
            error = surface;
        }
        if self.edge_length_bound > 0.0 {
            error = error.max(self.longest_edge_made(&s.adj_tris, new_position));
        }
        if move_verts {
            self.move_to(s, ([p0, p1], new_position), locked[0] || locked[1]);
        } else {
            error += penalty;
        }
        self.clear_flags(&s.adj_tris);
        error
    }

    /// The largest square, over the edge length bound's, of an edge the collapse makes: from `p`,
    /// where it moves the one corner it moves of a gathered triangle, to that triangle's two other
    /// corners. A triangle it moves two corners of, or none, makes no such edge.
    fn longest_edge_made(&self, adj_tris: &[usize], p: P) -> f32 {
        let bound2 = self.edge_length_bound * self.edge_length_bound;
        let mut longest2 = 0.0_f32;
        for &tri in adj_tris {
            if let Some([_, next, last]) = self.moved_wedge(tri) {
                longest2 = longest2.max(distance2(p, next)).max(distance2(p, last));
            }
        }
        // A bound whose square leaves the float range makes 0/0 or ∞/∞ here: it counts nothing.
        (longest2 / bound2).max(0.0)
    }
}
