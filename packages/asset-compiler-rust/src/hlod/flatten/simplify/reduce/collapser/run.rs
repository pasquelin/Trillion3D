//! The simplification loop, its last sweep and the output.
//!
//! Each turn takes the cheapest edge off the heap, unless `Stop` holds at its cost. A ring with an
//! edge between two locked vertices is dropped; otherwise what the two position rings touch is
//! gathered, the ring edges left without triangles at an end taken out, and — both ends of the
//! taken edge still standing — the rings' vertices moved to their collapsed selves (`collapsed`),
//! each live ring edge collapsed and taken out, the two position rings joined with the removed
//! vertices unlinked, a lock on any member spread to all, and the touched elements refreshed. A
//! dropped turn leaves its gathered elements to the next refresh.
//!
//! Once the loop stops, the triangles flat in double precision and the vertices without triangles
//! are taken out. The output lists each live triangle's corners in triangle order, a corner naming
//! the first output vertex exactly equal to its own — found in a table of 4096 buckets keyed by the
//! position's bits — or a new one.
use super::super::chains::{position_key, Chains};
use super::super::{Soup, Stop};
use super::{Collapser, LOCKED, MARK, REMOVED};
use smallvec::SmallVec;

/// The bucket count of the table the output vertices are found in.
const OUTPUT_BUCKETS: u32 = 4096;

impl Collapser {
    /// Collapses until `stop` holds or the heap is empty, then the last sweep.
    pub(super) fn run(&mut self, stop: &Stop) {
        while let Some((cost, top)) = self.heap.peek() {
            if stop.reached(self.live_triangles, cost) {
                break;
            }
            self.heap.pop();
            self.step(top);
        }
        self.sweep();
    }

    /// One turn on the ring of `top`, just taken off the heap.
    fn step(&mut self, top: u32) {
        let ring = self.edge_ring(top);
        let locked = ring.iter().any(|&e| {
            let [a, b] = self.edges[e as usize].ends;
            self.vertex_has(a, LOCKED) && self.vertex_has(b, LOCKED)
        });
        if locked {
            return;
        }
        let [u, v] = self.edges[top as usize].ends;
        for w in self.joint_ring(u, v) {
            self.gather(w);
        }
        let mut ring: SmallVec<[Option<u32>; 8]> = ring.into_iter().map(Some).collect();
        for slot in &mut ring {
            let Some(e) = *slot else { continue };
            if !self.ends_stand(e) {
                self.take_out_edge(e);
                *slot = None;
            }
        }
        if !self.ends_stand(top) {
            return;
        }
        self.move_rings(top);
        for e in ring.into_iter().flatten() {
            if self.edge_has(e, REMOVED) || !self.ends_stand(e) {
                continue;
            }
            self.collapse_edge(e);
            self.take_out_edge(e);
        }
        self.join_rings(top);
        self.refresh_triangles();
        self.refresh_vertices();
        self.refresh_edges();
    }

    /// Whether both of `e`'s ends still have a triangle.
    fn ends_stand(&self, e: u32) -> bool {
        let ends = self.edges[e as usize].ends;
        ends.iter()
            .all(|&v| !self.vertex_triangles[v as usize].is_empty())
    }

    /// The vertices of `top`'s rings given their collapsed selves, in the order `collapsed` lists
    /// them: each ring edge's second end, then the other members of the two position rings.
    fn move_rings(&mut self, top: u32) {
        let (collapsed, _) = self.collapsed(top);
        let mut collapsed = collapsed.into_iter();
        let [u, v] = self.edges[top as usize].ends;
        self.mark_ring(u, MARK, true);
        self.mark_ring(v, MARK, true);
        for e in self.edge_ring(top) {
            let [a, b] = self.edges[e as usize].ends;
            if let Some(vertex) = collapsed.next() {
                self.vertices[b as usize] = vertex;
            }
            self.mark_vertex(a, MARK, false);
            self.mark_vertex(b, MARK, false);
        }
        let rings = self.joint_ring(u, v);
        for w in rings {
            if self.vertex_has(w, MARK) {
                if let Some(vertex) = collapsed.next() {
                    self.vertices[w as usize] = vertex;
                }
                self.mark_vertex(w, MARK, false);
            }
        }
    }

    /// `top`'s two position rings joined, its first end's spliced in right after the first end,
    /// the removed vertices unlinked, the lock of any member spread to all.
    fn join_rings(&mut self, top: u32) {
        let [u, v] = self.edges[top as usize].ends;
        let (after_u, before_v) = (self.vertex_next[u as usize], self.vertex_prev[v as usize]);
        self.vertex_prev[after_u as usize] = before_v;
        let (after_u, before_v) = (self.vertex_next[u as usize], self.vertex_prev[v as usize]);
        self.vertex_next[before_v as usize] = after_u;
        self.vertex_next[u as usize] = v;
        self.vertex_prev[v as usize] = u;
        for w in self.vertex_ring(v) {
            if self.vertex_has(w, REMOVED) {
                self.unlink_vertex(w);
            }
        }
        let ring = self.vertex_ring(v);
        let lock = (ring.iter()).fold(0, |lock, &w| lock | self.vertex_flags[w as usize]) & LOCKED;
        for w in ring {
            self.vertex_flags[w as usize] |= lock;
        }
    }

    /// The flat triangles and the vertices without triangles taken out.
    fn sweep(&mut self) {
        for t in 0..self.corners.len() as u32 {
            if !self.triangle_has(t, REMOVED) && self.degenerate(t) {
                self.drop_triangle(t);
            }
        }
        for v in 0..self.vertices.len() as u32 {
            if !self.vertex_has(v, REMOVED) && self.vertex_triangles[v as usize].is_empty() {
                self.live_vertices -= 1;
                self.mark_vertex(v, REMOVED, true);
            }
        }
    }

    /// The live mesh, its vertices deduplicated in the order its triangles first name them; with
    /// `seams`, the output id of each locked vertex at its first naming.
    pub(super) fn live_soup(&self, mut seams: Option<&mut Vec<u32>>) -> Soup {
        let mut chains = Chains::new(OUTPUT_BUCKETS, self.live_vertices.max(0) as usize);
        let mut vertices = Vec::new();
        let mut indices = Vec::new();
        for t in 0..self.corners.len() as u32 {
            if self.triangle_has(t, REMOVED) {
                continue;
            }
            for w in self.corners[t as usize] {
                let vertex = self.vertices[w as usize];
                let key = position_key(vertex.position);
                let found = chains.chain(key).find(|&f| vertex == vertices[f as usize]);
                let at = match found {
                    Some(at) => at,
                    None => {
                        let at = vertices.len() as u32;
                        if self.vertex_has(w, LOCKED) {
                            if let Some(seams) = seams.as_deref_mut() {
                                seams.push(at);
                            }
                        }
                        chains.add(key, at);
                        vertices.push(vertex);
                        at
                    }
                };
                indices.push(at);
            }
        }
        Soup { vertices, indices }
    }
}
