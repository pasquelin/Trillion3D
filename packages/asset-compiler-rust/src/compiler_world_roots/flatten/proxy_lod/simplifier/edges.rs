//! Locked borders, the initial costs and the edge table.
use super::{add_unique, Simplifier, LOCKED, MARK1, MARK2, REMOVED};
use trillion3d_math::triangle::edge_key;

impl Simplifier {
    /// Locks the boundary: both ends of an edge one face
    /// alone touches are locked, with their groups.
    pub(crate) fn set_boundary_locked(&mut self) {
        for i in 0..self.verts.len() as u32 {
            // The group's adjacent vertices: every group member walks `i`'s own triangles.
            let mut adj = Vec::new();
            for g in self.group(i) {
                for &t in &self.verts[i as usize].adj {
                    for &u in &self.tris[t as usize].verts {
                        if u != g {
                            add_unique(&mut adj, u);
                        }
                    }
                }
            }
            for v1 in adj {
                if i < v1 {
                    self.set_adj_tri_flags_group(i, MARK1, true);
                    self.set_adj_tri_flags_group(v1, MARK1, false);
                    let mut faces = 0;
                    for g in self.group(i) {
                        for &t in &self.verts[g as usize].adj {
                            faces += if self.tris[t as usize].flags & MARK1 == MARK1 {
                                0
                            } else {
                                1
                            };
                        }
                    }
                    self.set_adj_tri_flags_group(i, MARK1, false);
                    if faces == 1 {
                        self.enable_group(i, LOCKED);
                        self.enable_group(v1, LOCKED);
                    }
                }
            }
        }
    }

    /// Every edge's collapse cost pushed on the heap.
    pub(crate) fn init_costs(&mut self) {
        for i in 0..self.edges.len() as u32 {
            let cost = self.collapse_cost(i);
            self.heap.insert(i, cost);
        }
    }

    fn find_edge(&self, u: u32, v: u32) -> Option<u32> {
        self.edge_hash.get(&edge_key(u, v)).copied()
    }

    fn ungroup_edge(&mut self, e: u32) {
        let (n, p) = (self.edges[e as usize].next, self.edges[e as usize].prev);
        self.edges[p as usize].next = n;
        self.edges[n as usize].prev = p;
        self.edges[e as usize].next = e;
        self.edges[e as usize].prev = e;
    }

    /// Marks `e` removed: out of the hash and the heap when it is the edge they hold, out of its
    /// group.
    pub(super) fn remove_edge(&mut self, e: u32) {
        if self.edges[e as usize].flags & REMOVED != 0 {
            return;
        }
        let key = edge_key(self.edges[e as usize].v0, self.edges[e as usize].v1);
        if self.edge_hash.get(&key) == Some(&e) {
            self.edge_hash.remove(&key);
            self.heap.remove(e);
        }
        self.edges[e as usize].flags |= REMOVED;
        self.ungroup_edge(e);
    }

    /// The edge `old_v`–`other_v` moved onto `new_v` (an edge already joining `new_v` and
    /// `other_v` removed), or removed when `new_v` is `None`.
    pub(super) fn replace_edge_vert(&mut self, old_v: u32, other_v: u32, new_v: Option<u32>) {
        let Some(&index) = self.edge_hash.get(&edge_key(old_v, other_v)) else {
            return;
        };
        self.edge_hash.remove(&edge_key(old_v, other_v));
        if let Some(new_v) = new_v {
            if let Some(existing) = self.find_edge(new_v, other_v) {
                self.remove_edge(existing);
            }
            self.edge_hash.insert(edge_key(new_v, other_v), index);
            let edge = &mut self.edges[index as usize];
            if edge.v0 == old_v {
                edge.v0 = new_v;
            } else {
                edge.v1 = new_v;
            }
        } else {
            self.edges[index as usize].flags |= REMOVED;
            self.ungroup_edge(index);
            self.heap.remove(index);
        }
    }

    /// The triangles, vertices and edges a collapse at `v` touches, queued for update.
    pub(super) fn gather_updates(&mut self, v: u32) {
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k];
            add_unique(&mut self.update_tris, t);
        }
        let adj = self.adjacent_verts(v);
        for &a in &adj {
            add_unique(&mut self.update_verts, a);
            self.verts[a as usize].flags |= MARK2;
        }
        for &a in &adj {
            self.set_adj_vert_flags(a, MARK1, true);
            for k in 0..self.verts[a as usize].adj.len() {
                let t = self.verts[a as usize].adj[k] as usize;
                for j in 0..3 {
                    let u = self.tris[t].verts[j];
                    if self.test(u, MARK1) && !self.test(u, MARK2) {
                        if let Some(e) = self.find_edge(a, u) {
                            add_unique(&mut self.update_edges, e);
                        }
                    }
                    self.verts[u as usize].flags &= !MARK1;
                }
            }
            self.verts[a as usize].flags &= !MARK2;
        }
    }
}
