//! Neighbourhoods, flags and the grouping of seams.
use super::{add_unique, pos_bits, Simplifier};
use trillion3d_page_codec::hash::WordMap;

impl Simplifier {
    /// The vertices sharing a triangle with `v`, each once, in first seen order.
    pub(super) fn adjacent_verts(&self, v: u32) -> Vec<u32> {
        let mut out = Vec::new();
        for &t in &self.verts[v as usize].adj {
            for &u in &self.tris[t as usize].verts {
                if u != v {
                    add_unique(&mut out, u);
                }
            }
        }
        out
    }

    pub(super) fn test(&self, v: u32, f: u32) -> bool {
        self.verts[v as usize].flags & f == f
    }

    pub(super) fn group(&self, v: u32) -> Vec<u32> {
        let mut out = vec![v];
        let mut u = self.verts[v as usize].next;
        while u != v {
            out.push(u);
            u = self.verts[u as usize].next;
        }
        out
    }

    pub(super) fn enable_group(&mut self, v: u32, f: u32) {
        for u in self.group(v) {
            self.verts[u as usize].flags |= f;
        }
    }

    pub(super) fn set_adj_vert_flags(&mut self, v: u32, f: u32, on: bool) {
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k] as usize;
            for j in 0..3 {
                let u = self.tris[t].verts[j] as usize;
                if on {
                    self.verts[u].flags |= f;
                } else {
                    self.verts[u].flags &= !f;
                }
            }
        }
    }

    pub(super) fn set_adj_tri_flags(&mut self, v: u32, f: u32, on: bool) {
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k] as usize;
            if on {
                self.tris[t].flags |= f;
            } else {
                self.tris[t].flags &= !f;
            }
        }
    }

    pub(super) fn set_adj_tri_flags_group(&mut self, v: u32, f: u32, on: bool) {
        for u in self.group(v) {
            self.set_adj_tri_flags(u, f, on);
        }
    }

    /// Groups the vertices by position: each vertex not yet grouped links the
    /// vertices at its position, in the order its hash bucket lists them (latest first).
    pub(super) fn group_verts(&mut self) {
        let mut buckets: WordMap<[u32; 3], Vec<u32>> = WordMap::default();
        for (i, v) in self.verts.iter().enumerate() {
            buckets
                .entry(pos_bits(v.vert.pos))
                .or_default()
                .push(i as u32);
        }
        for i in 0..self.verts.len() as u32 {
            if self.verts[i as usize].next != i {
                continue;
            }
            let bucket = &buckets[&pos_bits(self.verts[i as usize].vert.pos)];
            for &j in bucket.iter().rev() {
                if j == i {
                    continue;
                }
                let v1 = i as usize;
                let v2 = j as usize;
                self.verts[v2].next = self.verts[v1].next;
                self.verts[v2].prev = i;
                let n = self.verts[v2].next as usize;
                self.verts[n].prev = j;
                let p = self.verts[v2].prev as usize;
                self.verts[p].next = j;
            }
        }
    }

    fn positions_match(&self, e1: u32, e2: u32) -> (bool, bool) {
        let (a, b) = (&self.edges[e1 as usize], &self.edges[e2 as usize]);
        let pos = |v: u32| self.verts[v as usize].vert.pos;
        let m1 =
            (a.v0 == b.v0 && a.v1 == b.v1) || (pos(a.v0) == pos(b.v0) && pos(a.v1) == pos(b.v1));
        let m2 =
            (a.v0 == b.v1 && a.v1 == b.v0) || (pos(a.v0) == pos(b.v1) && pos(a.v1) == pos(b.v0));
        (m1, m2)
    }

    pub(super) fn edge_position_key(&self, e: u32) -> ([u32; 3], [u32; 3]) {
        let edge = &self.edges[e as usize];
        let (a, b) = (
            pos_bits(self.verts[edge.v0 as usize].vert.pos),
            pos_bits(self.verts[edge.v1 as usize].vert.pos),
        );
        (a.min(b), a.max(b))
    }

    /// Links `e2` after `e1` in `e1`'s group, turned to face the same way.
    pub(super) fn link_edge(&mut self, e1: u32, e2: u32) {
        let (m1, m2) = self.positions_match(e1, e2);
        if m2 {
            let e = &mut self.edges[e2 as usize];
            std::mem::swap(&mut e.v0, &mut e.v1);
        }
        if m1 || m2 {
            self.edges[e2 as usize].next = self.edges[e1 as usize].next;
            self.edges[e2 as usize].prev = e1;
            let n = self.edges[e2 as usize].next as usize;
            self.edges[n].prev = e2;
            let p = self.edges[e2 as usize].prev as usize;
            self.edges[p].next = e2;
        }
    }

    /// Groups the edges joining the same two positions, each turned to face its group's first.
    pub(super) fn group_edges(&mut self) {
        let mut buckets: WordMap<([u32; 3], [u32; 3]), Vec<u32>> = WordMap::default();
        for i in 0..self.edges.len() as u32 {
            buckets
                .entry(self.edge_position_key(i))
                .or_default()
                .push(i);
        }
        for i in 0..self.edges.len() as u32 {
            if self.edges[i as usize].next != i {
                continue;
            }
            let bucket = buckets[&self.edge_position_key(i)].clone();
            for &j in bucket.iter().rev() {
                if j != i {
                    self.link_edge(i, j);
                }
            }
        }
    }
}
