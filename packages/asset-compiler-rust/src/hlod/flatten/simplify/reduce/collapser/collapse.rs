//! One edge's collapse, its first end onto its second, and the gathering of what a collapse
//! touches.
//!
//! The collapse moves the first end's edges to the second, takes out those that would double one
//! of the second end's, takes out the triangles on the edge, gives the first end's other triangles
//! the second end in its place, puts the touched quadrics out of date and takes the first end out.
//! An edge whose ends share no triangle — what collapsing a bridging triangle leaves — collapses
//! nothing. Two guards stand where the method reads past its tables, on meshes it never meets: an
//! edge the table lacks is not moved, and a missing edge between touched vertices is not gathered.
use super::{edge_key, remove_once, Collapser, LOCKED, MARK, NEAR, REMOVED};
use crate::hlod::flatten::lists::push_unique;

impl Collapser {
    /// The triangles of `v`, the vertices they reach, and the edges from each of those to the
    /// vertices its own triangles reach but `v`'s do not (the edge to `v` among them, and those
    /// to the reached vertices already walked), added to the touched lists.
    pub(super) fn gather(&mut self, v: u32) {
        for &t in &self.vertex_triangles[v as usize] {
            push_unique(&mut self.touched_triangles, t);
        }
        let around = self.around(v);
        for &w in &around {
            push_unique(&mut self.touched_vertices, w);
            self.mark_vertex(w, NEAR, true);
        }
        for &w in &around {
            self.mark_around(w, MARK, true);
            for at in 0..self.vertex_triangles[w as usize].len() {
                let t = self.vertex_triangles[w as usize][at];
                for x in self.corners[t as usize] {
                    if self.vertex_has(x, MARK) && !self.vertex_has(x, NEAR) {
                        if let Some(e) = self.edge_between(w, x) {
                            push_unique(&mut self.touched_edges, e);
                        }
                    }
                    self.mark_vertex(x, MARK, false);
                }
            }
            self.mark_vertex(w, NEAR, false);
        }
    }

    /// `e` taken out: out of the table and the heap when the table files it, out of its ring.
    pub(super) fn take_out_edge(&mut self, e: u32) {
        if self.edge_has(e, REMOVED) {
            return;
        }
        let [a, b] = self.edges[e as usize].ends;
        let key = edge_key(a, b);
        if self.edge_chains.chain(key).any(|x| x == e) {
            self.edge_chains.remove(key, e);
            self.heap.remove(e);
        }
        self.edges[e as usize].flags |= REMOVED;
        self.unlink_edge(e);
    }

    /// The edge from `old` to `other` moved to run from `new` instead — any edge already there
    /// taken out first —, or taken out when there is no `new`.
    fn replace_end(&mut self, old: u32, other: u32, new: Option<u32>) {
        let key = edge_key(old, other);
        let joins = |[a, b]: [u32; 2]| (a == old && b == other) || (b == old && a == other);
        let Some(e) = self
            .edge_chains
            .chain(key)
            .find(|&x| joins(self.edges[x as usize].ends))
        else {
            return;
        };
        self.edge_chains.remove(key, e);
        match new {
            Some(new) => {
                if let Some(existing) = self.edge_between(new, other) {
                    self.take_out_edge(existing);
                }
                self.edge_chains.add(edge_key(new, other), e);
                let ends = &mut self.edges[e as usize].ends;
                let k = if ends[0] == old { 0 } else { 1 };
                ends[k] = new;
            }
            None => {
                self.edges[e as usize].flags |= REMOVED;
                self.unlink_edge(e);
                self.heap.remove(e);
            }
        }
    }

    /// For each corner of `walk`'s triangles still marked, the edge from `old` to it moved to
    /// `new` (`replace_end`), and the mark cleared.
    fn replace_marked(&mut self, walk: u32, old: u32, new: Option<u32>) {
        for at in 0..self.vertex_triangles[walk as usize].len() {
            let t = self.vertex_triangles[walk as usize][at];
            for w in self.corners[t as usize] {
                if self.vertex_has(w, MARK) {
                    self.replace_end(old, w, new);
                    self.mark_vertex(w, MARK, false);
                }
            }
        }
    }

    /// `edge` collapsed, its first end `u` onto its second `v`.
    pub(super) fn collapse_edge(&mut self, edge: u32) {
        let [u, v] = self.edges[edge as usize].ends;
        if self.vertex_has(u, LOCKED) {
            self.mark_vertex(v, LOCKED, true);
        }
        // The vertices `u`'s triangles reach and `v`'s do not.
        self.mark_around(u, MARK, true);
        self.mark_around(v, MARK, false);
        if self.vertex_has(u, MARK) {
            self.mark_around(u, MARK, false);
            return;
        }
        self.replace_marked(u, u, Some(v));
        // The vertices both reach: their edges from `u` would double those from `v`.
        self.mark_around(u, MARK, true);
        self.mark_vertex(u, MARK, false);
        self.mark_vertex(v, MARK, false);
        self.replace_marked(v, u, None);
        self.mark_around(u, MARK, false);
        for at in 0..self.vertex_triangles[u as usize].len() {
            let t = self.vertex_triangles[u as usize][at];
            let corners = self.corners[t as usize];
            if corners.contains(&v) {
                self.live_triangles -= 1;
                self.mark_triangle(t, REMOVED, true);
                self.triangle_quadrics[t as usize] = None;
                for w in corners {
                    if w != u {
                        remove_once(&mut self.vertex_triangles[w as usize], t);
                    }
                }
            } else {
                let k = if corners[0] == u {
                    0
                } else if corners[1] == u {
                    1
                } else {
                    2
                };
                self.corners[t as usize][k] = v;
                self.vertex_triangles[v as usize].push(t);
            }
        }
        // The quadrics of `v`'s triangles and of the vertices they reach.
        self.mark_around(v, MARK, true);
        for at in 0..self.vertex_triangles[v as usize].len() {
            let t = self.vertex_triangles[v as usize][at];
            self.triangle_quadrics[t as usize] = None;
            for w in self.corners[t as usize] {
                if self.vertex_has(w, MARK) {
                    self.vertex_quadrics[w as usize] = None;
                    self.mark_vertex(w, MARK, false);
                }
            }
        }
        self.vertex_triangles[u as usize].clear();
        self.mark_vertex(u, REMOVED, true);
        self.live_vertices -= 1;
    }
}
