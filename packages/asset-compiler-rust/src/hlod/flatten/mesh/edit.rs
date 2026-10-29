//! The edits that take a mesh's elements away or split one, each taking and freeing ids in the
//! order written:
//!
//! - a triangle taken away (`remove_triangle`): freed from its edges in turn, an edge left with no
//!   triangle unlisted by its ends and freed; then the triangle freed and its corners counted
//!   down, a corner left bare freed with it when asked;
//! - a vertex taken away (`remove_vertex`): its triangles — each edge's first then second, every
//!   triangle once, while the vertex lists at most `GATHERED_UP_TO` edges, else as
//!   `Mesh::triangles_at` visits them — taken away in that order, their bare corners kept; then
//!   the vertex freed;
//! - an edge split at a share of the way along it (`split_edge`): a new vertex on it, the far part
//!   of each triangle holding it made a new triangle, three new edges on a held side and two on the
//!   boundary.
use super::links::wound;
use super::{Mesh, NONE};

/// The most edges a vertex may list for its triangles to be gathered from every edge's two in
/// turn; past it each edge gives only those that leave the vertex along it.
const GATHERED_UP_TO: usize = 20;

/// An edge split (`split_edge`): the new vertex, the edge's ends as its first triangle winds them,
/// the new vertex's share of the way from the first end to the second, the corners across the edge
/// — the first triangle's, then the second's or `NONE` on the boundary —, and the new edges — to
/// the second end, to the first triangle's far corner, from the second triangle's far corner or
/// `NONE` on the boundary.
pub(crate) struct Split {
    pub(crate) vertex: usize,
    pub(crate) ends: [usize; 2],
    pub(crate) t: f64,
    pub(crate) across: [usize; 2],
    pub(crate) edges: [usize; 3],
}

impl Mesh {
    /// Triangle `t` taken away (module doc), its corners left bare freed when `free_bare` says so.
    pub(crate) fn remove_triangle(&mut self, t: usize, free_bare: bool) {
        let (tri, sides) = (self.corners(t), self.sides_of(t));
        for e in sides {
            self.replace_face(e, t, NONE);
            if self.faces(e)[0] == NONE {
                let [a, b] = self.ends(e);
                self.unlink(a, e);
                self.unlink(b, e);
                self.edge_ids.count_down(e, 1);
            }
        }
        self.triangle_ids.count_down(t, 1);
        for v in tri {
            self.vertex_ids.count_down(v, 1);
            if free_bare && self.vertex_ids.count(v) == 1 {
                self.vertex_ids.count_down(v, 1);
                self.around[v].clear();
            }
        }
    }

    /// Standing vertex `v` taken away with its triangles (module doc), the corners they leave bare
    /// kept.
    pub(crate) fn remove_vertex(&mut self, v: usize) {
        for t in self.ring(v) {
            self.remove_triangle(t, false);
        }
        self.vertex_ids.count_down(v, 1);
        self.around[v].clear();
    }

    /// Vertex `v`'s triangles in the order its removal takes them (module doc).
    fn ring(&self, v: usize) -> Vec<usize> {
        if self.around[v].len() > GATHERED_UP_TO {
            return self.triangles_at(v).collect();
        }
        let mut ring = Vec::new();
        for e in self.edges_at(v) {
            for t in self.faces(e) {
                if t != NONE && !ring.contains(&t) {
                    ring.push(t);
                }
            }
        }
        ring
    }

    /// Standing edge `e` split at share `t` of the way from its lower end to its higher one, the
    /// new vertex's id taken before the new triangles' and those before the new edges'; none when a
    /// corner across it is counted too near the limit of its count (`Ids::crowded`). The new
    /// vertex is listed with the edge's part from the first end, the edge's other end losing it.
    pub(crate) fn split_edge(&mut self, e: usize, t: f64) -> Option<Split> {
        let [low, high] = self.ends(e);
        let [t0, t1] = self.faces(e);
        let [a, b, c] = wound(low, high, self.corners(t0));
        if self.vertex_ids.crowded(c) {
            return None;
        }
        // The share is measured from the end the first triangle winds first.
        let t = if a != low { 1.0 - t } else { t };
        if t1 == NONE {
            let f = self.add_vertex();
            let ebc = self.side_on(t0, b, c);
            self.replace_corner(t0, b, f);
            let t2 = self.add_triangle([f, b, c], [NONE; 3]);
            self.replace_face(ebc, t0, t2);
            self.move_end(e, b, f);
            let efb = self.add_edge(f, b, [t2, NONE]);
            let efc = self.add_edge(f, c, [t0, t2]);
            self.replace_side(t0, ebc, efc);
            self.sides[t2] = [efb, ebc, efc].map(|e| e as u32);
            self.vertex_ids.count_up(c, 1);
            self.vertex_ids.count_up(f, 2);
            return Some(Split {
                vertex: f,
                ends: [a, b],
                t,
                across: [c, NONE],
                edges: [efb, efc, NONE],
            });
        }
        let d = wound(a, b, self.corners(t1))[2];
        if self.vertex_ids.crowded(d) {
            return None;
        }
        let f = self.add_vertex();
        let ebc = self.side_on(t0, b, c);
        let edb = self.side_on(t1, d, b);
        self.replace_corner(t0, b, f);
        self.replace_corner(t1, b, f);
        let t2 = self.add_triangle([f, b, c], [NONE; 3]);
        let t3 = self.add_triangle([f, d, b], [NONE; 3]);
        self.replace_face(ebc, t0, t2);
        self.replace_face(edb, t1, t3);
        self.move_end(e, b, f);
        let efb = self.add_edge(f, b, [t2, t3]);
        let efc = self.add_edge(f, c, [t0, t2]);
        let edf = self.add_edge(d, f, [t1, t3]);
        self.replace_side(t0, ebc, efc);
        self.replace_side(t1, edb, edf);
        self.sides[t2] = [efb, ebc, efc].map(|e| e as u32);
        self.sides[t3] = [edf, edb, efb].map(|e| e as u32);
        self.vertex_ids.count_up(c, 1);
        self.vertex_ids.count_up(d, 1);
        self.vertex_ids.count_up(f, 4);
        Some(Split {
            vertex: f,
            ends: [a, b],
            t,
            across: [c, d],
            edges: [efb, efc, edf],
        })
    }

    /// Edge `e`'s end `old` moved to `new`: the edge's ends rewritten, `old` unlisting it and `new`
    /// listing it.
    fn move_end(&mut self, e: usize, old: usize, new: usize) {
        self.replace_end(e, old, new);
        self.unlink(old, e);
        self.link(new, e);
    }
}
