//! The simplification loop.
use super::{Simplifier, Terminator, LOCKED, MARK1, REMOVED};

impl Simplifier {
    /// Simplifies: the cheapest edge group collapsed until
    /// the terminator stops, then null triangles and orphaned vertices removed.
    pub(crate) fn simplify(&mut self, terminator: Terminator) {
        while let Some((error, top)) = self.heap.peek() {
            if terminator.stop(self.num_tris, error) {
                break;
            }
            self.heap.pop();
            let mut list = vec![top];
            let mut e = self.edges[top as usize].next;
            while e != top {
                list.push(e);
                e = self.edges[e as usize].next;
            }
            if list.iter().any(|&e| {
                let edge = &self.edges[e as usize];
                self.test(edge.v0, LOCKED) && self.test(edge.v1, LOCKED)
            }) {
                continue;
            }
            let (tv0, tv1) = (self.edges[top as usize].v0, self.edges[top as usize].v1);
            for start in [tv0, tv1] {
                for v in self.group(start) {
                    self.gather_updates(v);
                }
            }
            // An edge removed here is skipped below by its flag.
            for &e in &list {
                let (a, b) = (self.edges[e as usize].v0, self.edges[e as usize].v1);
                if self.verts[a as usize].adj.is_empty() || self.verts[b as usize].adj.is_empty() {
                    self.remove_edge(e);
                }
            }
            if self.verts[tv0 as usize].adj.is_empty() || self.verts[tv1 as usize].adj.is_empty() {
                continue;
            }
            // The merged vertices take their new values.
            let (new_verts, _) = self.new_verts(top);
            let mut i = 0;
            self.enable_group(tv0, MARK1);
            self.enable_group(tv1, MARK1);
            let mut e = top;
            loop {
                let (a, b) = (self.edges[e as usize].v0, self.edges[e as usize].v1);
                self.verts[b as usize].vert = new_verts[i];
                i += 1;
                self.verts[a as usize].flags &= !MARK1;
                self.verts[b as usize].flags &= !MARK1;
                e = self.edges[e as usize].next;
                if e == top {
                    break;
                }
            }
            for start in [tv0, tv1] {
                for v in self.group(start) {
                    if self.test(v, MARK1) {
                        self.verts[v as usize].vert = new_verts[i];
                        i += 1;
                        self.verts[v as usize].flags &= !MARK1;
                    }
                }
            }
            for e in list {
                let edge = &self.edges[e as usize];
                if edge.flags & REMOVED != 0
                    || self.verts[edge.v0 as usize].adj.is_empty()
                    || self.verts[edge.v1 as usize].adj.is_empty()
                {
                    continue;
                }
                self.collapse(e);
                self.remove_edge(e);
            }
            // The groups of v0 and v1 joined, the removed vertices taken out.
            let (tv0, tv1) = (self.edges[top as usize].v0, self.edges[top as usize].v1);
            let v0_next = self.verts[tv0 as usize].next;
            let v1_prev = self.verts[tv1 as usize].prev;
            self.verts[v0_next as usize].prev = v1_prev;
            self.verts[v1_prev as usize].next = v0_next;
            self.verts[tv0 as usize].next = tv1;
            self.verts[tv1 as usize].prev = tv0;
            for v in self.group(tv1) {
                if self.test(v, REMOVED) {
                    let (n, p) = (self.verts[v as usize].next, self.verts[v as usize].prev);
                    self.verts[p as usize].next = n;
                    self.verts[n as usize].prev = p;
                    self.verts[v as usize].next = v;
                    self.verts[v as usize].prev = v;
                }
            }
            let group = self.group(tv1);
            let locked = group
                .iter()
                .fold(0, |f, &v| f | (self.verts[v as usize].flags & LOCKED));
            for v in group {
                self.verts[v as usize].flags |= locked;
            }
            self.update_tris();
            self.update_verts();
            self.update_edges();
        }
        for t in 0..self.tris.len() as u32 {
            if self.tris[t as usize].flags & REMOVED != 0 {
                continue;
            }
            if self.degenerate(t as usize) {
                self.remove_tri(t);
            }
        }
        for v in 0..self.verts.len() {
            if self.verts[v].flags & REMOVED != 0 {
                continue;
            }
            if self.verts[v].adj.is_empty() {
                self.verts[v].flags |= REMOVED;
            }
        }
    }
}
