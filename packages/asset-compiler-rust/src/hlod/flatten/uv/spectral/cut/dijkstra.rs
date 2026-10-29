//! Shortest edge paths from a set of sources, each vertex keeping its distance and the next
//! vertex toward the sources.
//!
//! The sources start at distance zero, already settled; each step settles the nearest vertex in
//! the heap, relaxes the edges around it, then puts or moves its unsettled neighbours in the heap
//! in ring order. A search toward another boundary stops at the first settled boundary vertex of
//! another boundary and may refuse to cross false edges; a search from one vertex runs to the end
//! and gives the last vertex it settled.
use crate::hlod::flatten::uv::spectral::mesh::{Chart, NONE};
use trillion3d_math::heap::{Greatest, IndexedHeap};

/// Where a search stops: at a boundary vertex whose boundary differs from `own`.
pub(super) struct Stop<'b> {
    pub boundary_of: &'b [u32],
    pub own: u32,
}

impl<'a> Chart<'a> {
    /// The search from `sources`: the stopping vertex when `stop` is given (`None` when no other
    /// boundary is reached), else the last vertex settled.
    pub(super) fn edge_search(
        &mut self,
        sources: &[u32],
        avoid_false_edges: bool,
        stop: Option<&Stop>,
    ) -> Option<u32> {
        let count = self.verts.len();
        let mut settled = vec![false; count];
        let mut heap = IndexedHeap::<Greatest>::new(count);
        for v in &mut self.verts {
            v.geodesic = f32::MAX;
            v.next = NONE;
        }
        for &s in sources {
            settled[s as usize] = true;
            self.verts[s as usize].geodesic = 0.0;
            heap.insert(s, -self.verts[s as usize].geodesic);
        }
        let blocked =
            |chart: &Chart, e: u32| avoid_false_edges && !chart.edges[e as usize].splittable;
        let mut last = None;
        for _ in 0..count {
            let Some(v) = heap.pop() else {
                break;
            };
            settled[v as usize] = true;
            last = Some(v);
            if let Some(stop) = stop {
                if self.verts[v as usize].boundary && stop.boundary_of[v as usize] != stop.own {
                    return Some(v);
                }
            }
            let here = self.verts[v as usize].geodesic;
            for j in 0..self.verts[v as usize].edges.len() {
                let e = self.verts[v as usize].edges[j];
                if blocked(self, e) {
                    continue;
                }
                let edge = &self.edges[e as usize];
                let other = edge.other_end(v);
                if settled[other as usize] {
                    continue;
                }
                let length = edge.length;
                let target = &mut self.verts[other as usize];
                if target.geodesic > here + length {
                    target.geodesic = here + length;
                    target.next = v;
                }
            }
            for j in 0..self.verts[v as usize].verts.len() {
                let n = self.verts[v as usize].verts[j];
                if settled[n as usize] || blocked(self, self.verts[v as usize].edges[j]) {
                    continue;
                }
                let key = -self.verts[n as usize].geodesic;
                if heap.contains(n) {
                    heap.update(n, key);
                } else {
                    heap.insert(n, key);
                }
            }
        }
        if stop.is_some() {
            None
        } else {
            last
        }
    }

    /// Shortest edge paths from `source` to every vertex; the farthest vertex settled.
    pub(crate) fn dijkstra_from(&mut self, source: u32) -> u32 {
        self.edge_search(&[source], false, None).unwrap_or(NONE)
    }

    /// The path from vertex `v` back to the sources, ordered from the sources to `v`.
    pub(super) fn path_to_source(&self, v: u32) -> Vec<u32> {
        let mut path = vec![v];
        let mut at = v;
        while self.verts[at as usize].next != NONE {
            at = self.verts[at as usize].next;
            path.push(at);
        }
        path.reverse();
        path
    }
}
