//! A collapse and the updates of the triangles, vertices and edges it touches.
use super::attributes::wide;
use super::{add_unique, remove_adj, Simplifier, LOCKED, MARK1, REMOVED};
use trillion3d_math::vec3::cross;
use trillion3d_math::vecn::{squared_length, sub};
use trillion3d_page_codec::hash::WordMap;

impl Simplifier {
    /// Collapses `edge`: `u` moved onto `v`.
    pub(super) fn collapse(&mut self, edge: u32) {
        let (u, v) = (self.edges[edge as usize].v0, self.edges[edge as usize].v1);
        if self.test(u, LOCKED) {
            self.verts[v as usize].flags |= LOCKED;
        }
        self.set_adj_vert_flags(u, MARK1, true);
        self.set_adj_vert_flags(v, MARK1, false);
        if self.test(u, MARK1) {
            self.set_adj_vert_flags(u, MARK1, false);
            return;
        }
        for k in 0..self.verts[u as usize].adj.len() {
            let t = self.verts[u as usize].adj[k] as usize;
            for j in 0..3 {
                let w = self.tris[t].verts[j];
                if self.test(w, MARK1) {
                    self.replace_edge_vert(u, w, Some(v));
                    self.verts[w as usize].flags &= !MARK1;
                }
            }
        }
        self.set_adj_vert_flags(u, MARK1, true);
        self.verts[u as usize].flags &= !MARK1;
        self.verts[v as usize].flags &= !MARK1;
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k] as usize;
            for j in 0..3 {
                let w = self.tris[t].verts[j];
                if self.test(w, MARK1) {
                    self.replace_edge_vert(u, w, None);
                    self.verts[w as usize].flags &= !MARK1;
                }
            }
        }
        self.set_adj_vert_flags(u, MARK1, false);
        for k in 0..self.verts[u as usize].adj.len() {
            let t = self.verts[u as usize].adj[k];
            let tri = self.tris[t as usize].verts;
            if tri.contains(&v) {
                self.num_tris -= 1;
                self.tris[t as usize].flags |= REMOVED;
                self.tri_quadrics[t as usize] = None;
                for w in tri {
                    if w != u {
                        remove_adj(&mut self.verts[w as usize].adj, t);
                    }
                }
            } else {
                let slot = tri.iter().position(|&w| w == u).expect("u in its triangle");
                self.tris[t as usize].verts[slot] = v;
                self.verts[v as usize].adj.push(t);
            }
        }
        self.set_adj_vert_flags(v, MARK1, true);
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k] as usize;
            self.tri_quadrics[t] = None;
            for j in 0..3 {
                let w = self.tris[t].verts[j];
                if self.test(w, MARK1) {
                    self.vert_quadrics[w as usize] = None;
                    self.verts[w as usize].flags &= !MARK1;
                }
            }
        }
        self.verts[u as usize].adj.clear();
        self.verts[u as usize].flags |= REMOVED;
    }

    /// The doubled cross product a triangle is removed by when null.
    pub(super) fn degenerate(&self, t: usize) -> bool {
        let [p0, p1, p2] = self.tris[t]
            .verts
            .map(|u| wide(self.verts[u as usize].vert.pos));
        let a = sub(p2, p0);
        let b = sub(p1, p0);
        let n = cross(a, b);
        squared_length(n) == 0.0
    }

    pub(super) fn remove_tri(&mut self, t: u32) {
        self.num_tris -= 1;
        self.tris[t as usize].flags |= REMOVED;
        for w in self.tris[t as usize].verts {
            remove_adj(&mut self.verts[w as usize].adj, t);
        }
    }

    /// The queued triangles: their quadric dropped, removed when degenerate.
    pub(super) fn update_tris(&mut self) {
        for t in std::mem::take(&mut self.update_tris) {
            if self.tris[t as usize].flags & REMOVED != 0 {
                continue;
            }
            self.tri_quadrics[t as usize] = None;
            if self.degenerate(t as usize) {
                self.remove_tri(t);
            }
        }
    }

    /// The queued vertices: their quadrics dropped, removed when no triangle uses them.
    pub(super) fn update_verts(&mut self) {
        for v in std::mem::take(&mut self.update_verts) {
            if self.test(v, REMOVED) {
                continue;
            }
            self.vert_quadrics[v as usize] = None;
            self.edge_quadrics[v as usize] = None;
            if self.verts[v as usize].adj.is_empty() {
                self.verts[v as usize].flags |= REMOVED;
                let (n, p) = (self.verts[v as usize].next, self.verts[v as usize].prev);
                self.verts[p as usize].next = n;
                self.verts[n as usize].prev = p;
                self.verts[v as usize].next = v;
                self.verts[v as usize].prev = v;
            }
        }
    }

    /// The queued edges with their groups: removed where an end is gone, regrouped by position,
    /// each group's cost updated on the heap.
    pub(super) fn update_edges(&mut self) {
        let num = self.update_edges.len();
        for i in 0..num {
            let edge = self.update_edges[i];
            if self.edges[edge as usize].flags & REMOVED != 0 {
                continue;
            }
            let mut e = edge;
            loop {
                add_unique(&mut self.update_edges, e);
                e = self.edges[e as usize].next;
                if e == edge {
                    break;
                }
            }
        }
        for i in 0..self.update_edges.len() {
            let e = self.update_edges[i];
            if self.edges[e as usize].flags & REMOVED != 0 {
                continue;
            }
            let (a, b) = (self.edges[e as usize].v0, self.edges[e as usize].v1);
            if self.test(a, REMOVED) || self.test(b, REMOVED) {
                self.remove_edge(e);
            }
        }
        let mut buckets: WordMap<([u32; 3], [u32; 3]), Vec<usize>> = WordMap::default();
        for i in 0..self.update_edges.len() {
            let e = self.update_edges[i];
            if self.edges[e as usize].flags & REMOVED != 0 {
                continue;
            }
            self.edges[e as usize].next = e;
            self.edges[e as usize].prev = e;
            buckets
                .entry(self.edge_position_key(e))
                .or_default()
                .push(i);
        }
        for i in 0..self.update_edges.len() {
            let e1 = self.update_edges[i];
            if self.edges[e1 as usize].flags & REMOVED != 0 || self.edges[e1 as usize].next != e1 {
                continue;
            }
            let bucket = buckets[&self.edge_position_key(e1)].clone();
            for &j in bucket.iter().rev() {
                let e2 = self.update_edges[j];
                if e1 != e2 {
                    self.link_edge(e1, e2);
                }
            }
        }
        for i in 0..num {
            let edge = self.update_edges[i];
            if self.edges[edge as usize].flags & REMOVED != 0 {
                continue;
            }
            let cost = self.collapse_cost(edge);
            let mut e = edge;
            loop {
                if self.heap.contains(e) {
                    self.heap.update(e, cost);
                }
                e = self.edges[e as usize].next;
                if e == edge {
                    break;
                }
            }
        }
        self.update_edges.clear();
    }
}
