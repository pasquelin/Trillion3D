//! A collapse: its cost, where it puts the merged position and the attributes each wedge takes
//! there; made, it moves every vertex there (`moves.rs`).
use super::super::quadric::{self, Optimizer, PositionQuadric};
use super::{
    about, attributes, Simplifier, ADJ_TRI, DEGREE_LIMIT, DEGREE_PENALTY, INVERSION_PENALTY,
    LOCKED, LOCK_PENALTY, MERGE_MASK, P,
};
use trillion3d_math::aabb::extend_aabb_f32;
use trillion3d_math::vecn::{add, distance2};

/// A vertex at one of the pair's positions and the gathered triangle it was met in.
#[derive(Clone, Copy)]
struct WedgeVert {
    vert: u32,
    adj: usize,
}

/// What one evaluation gathers, kept between evaluations so they allocate nothing once grown.
#[derive(Default)]
pub(super) struct Scratch {
    /// The live triangles at either position, in the order met.
    pub(super) adj_tris: Vec<usize>,
    /// Per position, its vertices and the triangle each was first met in.
    wedge_verts: [Vec<WedgeVert>; 2],
    /// The union of the gathered triangles into wedges, by their rank in `adj_tris`.
    parents: Vec<u32>,
    /// Per gathered triangle, its wedge; per wedge, its union root, quadric and attributes.
    pub(super) wedge_of: Vec<usize>,
    wedge_ids: Vec<u32>,
    pub(super) wedge_quadrics: Vec<f64>,
    pub(super) wedge_values: Vec<f32>,
}

/// Joins the newest triangle `x` to `y`'s wedge.
fn union_sequential(parents: &mut [u32], x: usize, mut y: usize) {
    let px = x as u32;
    let mut py = parents[y];
    while px != py {
        parents[y] = px;
        if y as u32 == py {
            return;
        }
        y = py as usize;
        py = parents[y];
    }
}

fn union(parents: &mut [u32], mut x: usize, mut y: usize) {
    let (mut px, mut py) = (parents[x], parents[y]);
    while px != py {
        if px < py {
            parents[x] = py;
            if x as u32 == px {
                return;
            }
            x = px as usize;
            px = parents[x];
        } else {
            parents[y] = px;
            if y as u32 == py {
                return;
            }
            y = py as usize;
            py = parents[y];
        }
    }
}

fn find(parents: &mut [u32], start: usize) -> u32 {
    let mut i = start as u32;
    let mut root = parents[i as usize];
    while root != i {
        i = root;
        root = parents[i as usize];
    }
    let mut i = start as u32;
    let mut parent = parents[i as usize];
    while parent != root {
        parents[i as usize] = root;
        i = parent;
        parent = parents[i as usize];
    }
    root
}

impl Simplifier {
    /// The cost of merging positions `p0` and `p1`, penalties included unless the merge is made
    /// (`move_verts`), when it returns the error made; and whether it measured a hole.
    pub(super) fn evaluate_merge(&mut self, p0: P, p1: P, move_verts: bool) -> (f32, bool) {
        if p0 == p1 {
            return (0.0, false);
        }
        let mut s = std::mem::take(&mut self.scratch);
        let error = self.merge_with(&mut s, p0, p1, move_verts);
        self.scratch = s;
        error
    }

    fn merge_with(&mut self, s: &mut Scratch, p0: P, p1: P, move_verts: bool) -> (f32, bool) {
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
                let (adj, new_tri) = if *first & ADJ_TRI == 0 {
                    *first |= ADJ_TRI;
                    s.adj_tris.push(tri);
                    s.parents.push(s.parents.len() as u32);
                    (s.parents.len() - 1, true)
                } else {
                    let at = s.adj_tris.iter().position(|&t| t == tri);
                    (at.expect("a gathered triangle"), false)
                };
                let vert = self.indexes[corner];
                match s.wedge_verts[index].iter().find(|w| w.vert == vert) {
                    None => s.wedge_verts[index].push(WedgeVert { vert, adj }),
                    Some(other) if new_tri => union_sequential(&mut s.parents, adj, other.adj),
                    Some(other) => union(&mut s.parents, adj, other.adj),
                }
            }
        }
        if degree == 0 {
            return (0.0, false);
        }
        // Collapsing it would remove every triangle left.
        if degree as usize == self.remaining_tris * 2 {
            self.clear_flags(&s.adj_tris);
            return (0.0, false);
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
            let id = find(&mut s.parents, adj);
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
                let found = [
                    optimizer.optimize_volume().map(plus),
                    optimizer.optimize().map(plus),
                    optimizer.optimize_linear([0.0; 3], about(p1, p0)).map(plus),
                ];
                match found.into_iter().flatten().find(|&p| valid(self, p)) {
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
        // All the area it touches: it takes a piece's shape away, and the holes too (`ghosts.rs`).
        let capped = disjoint || (surface > 0.0 && error >= surface);
        if capped {
            error = self.hole_opened(&s.adj_tris, [p0, p1], new_position, error, move_verts);
        }
        if move_verts {
            if capped {
                self.leave_ghosts(&s.adj_tris, error);
            }
            self.move_to(s, ([p0, p1], new_position), locked[0] || locked[1]);
        } else {
            error += penalty;
        }
        self.clear_flags(&s.adj_tris);
        (error, capped)
    }
}
