//! The touched elements brought up to date after a collapse, in their touched order: each
//! triangle's quadric put out of date and the triangle taken out when its corners span no area;
//! each vertex's quadrics put out of date and the vertex taken out, and out of its ring, when it
//! has no triangle left; each edge's whole ring touched with it, an edge taken out when an end is
//! gone, the touched edges ringed again from scratch, and each first-touched edge priced again,
//! its cost given to every edge of its ring still on the heap.
use super::super::chains::{position_key, Chains};
use super::{remove_once, Collapser, REMOVED};
use crate::hlod::flatten::lists::push_unique;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{squared_length, sub};

/// The bucket count of the table the touched edges are ringed again through.
const REGROUP_BUCKETS: u32 = 128;

impl Collapser {
    /// Whether `t`'s corners span no area in double precision.
    pub(super) fn degenerate(&self, t: u32) -> bool {
        let [p0, p1, p2] = self.corners[t as usize].map(|v| self.position(v).map(f64::from));
        squared_length(cross(sub(p2, p0), sub(p1, p0))) == 0.0
    }

    /// `t` taken out of the mesh and out of each corner's triangles.
    pub(super) fn drop_triangle(&mut self, t: u32) {
        self.live_triangles -= 1;
        self.mark_triangle(t, REMOVED, true);
        for v in self.corners[t as usize] {
            remove_once(&mut self.vertex_triangles[v as usize], t);
        }
    }

    /// The touched triangles still in the mesh: quadric out of date, taken out when flat.
    pub(super) fn refresh_triangles(&mut self) {
        for at in 0..self.touched_triangles.len() {
            let t = self.touched_triangles[at];
            if self.triangle_has(t, REMOVED) {
                continue;
            }
            self.triangle_quadrics[t as usize] = None;
            if self.degenerate(t) {
                self.drop_triangle(t);
            }
        }
        self.touched_triangles.clear();
    }

    /// The touched vertices still in the mesh: both quadrics out of date, taken out with no
    /// triangle left.
    pub(super) fn refresh_vertices(&mut self) {
        for at in 0..self.touched_vertices.len() {
            let v = self.touched_vertices[at];
            if self.vertex_has(v, REMOVED) {
                continue;
            }
            self.vertex_quadrics[v as usize] = None;
            self.boundary_quadrics[v as usize] = None;
            if self.vertex_triangles[v as usize].is_empty() {
                self.live_vertices -= 1;
                self.mark_vertex(v, REMOVED, true);
                self.unlink_vertex(v);
            }
        }
        self.touched_vertices.clear();
    }

    /// The key `e` is ringed again under: its ends' position keys, combined either way round.
    fn ends_key(&self, e: u32) -> u32 {
        let [a, b] = self.edges[e as usize].ends;
        position_key(self.position(a)) ^ position_key(self.position(b))
    }

    /// The touched edges: their rings touched with them, the dead taken out, the rest ringed again
    /// through a table of `REGROUP_BUCKETS` buckets, the first-touched priced again.
    pub(super) fn refresh_edges(&mut self) {
        let first = self.touched_edges.len();
        for at in 0..first {
            let e = self.touched_edges[at];
            if self.edge_has(e, REMOVED) {
                continue;
            }
            for member in self.edge_ring(e) {
                push_unique(&mut self.touched_edges, member);
            }
        }
        let count = self.touched_edges.len();
        for at in 0..count {
            let e = self.touched_edges[at];
            if self.edge_has(e, REMOVED) {
                continue;
            }
            let [a, b] = self.edges[e as usize].ends;
            if self.vertex_has(a, REMOVED) || self.vertex_has(b, REMOVED) {
                self.take_out_edge(e);
            }
        }
        // Every touched edge alone in its ring, filed by its rank among the touched.
        let mut chains = Chains::new(REGROUP_BUCKETS, first);
        for at in 0..count {
            let e = self.touched_edges[at];
            if self.edge_has(e, REMOVED) {
                continue;
            }
            self.edges[e as usize].next = e;
            self.edges[e as usize].prev = e;
            chains.add(self.ends_key(e), at as u32);
        }
        for at in 0..count {
            let e = self.touched_edges[at];
            if self.edge_has(e, REMOVED) || self.edges[e as usize].next != e {
                continue;
            }
            for rank in chains.chain(self.ends_key(e)) {
                let other = self.touched_edges[rank as usize];
                if other != e {
                    self.match_edge(e, other);
                }
            }
        }
        for at in 0..first {
            let e = self.touched_edges[at];
            if self.edge_has(e, REMOVED) {
                continue;
            }
            let cost = self.collapse_cost(e);
            for member in self.edge_ring(e) {
                if self.heap.contains(member) {
                    self.heap.update(member, cost);
                }
            }
        }
        self.touched_edges.clear();
    }
}
