//! The collapser built from a soup: each vertex given its triangles in triangle order; the
//! vertices at one exact position ringed, each found in a table of buckets for half the
//! vertices keyed by its position's bits and put right after the first of the ring; an edge for
//! each pair of vertices sharing a triangle, the lower id first, listed vertex by vertex in the
//! order the lower one's triangles reach the other; the edges joining the same two positions ringed the same way, a
//! reversed one turned to match; the table of edges by their ends' ids. Then, for a slab, the
//! boundary locked — both rings of every edge one triangle borders —, and every edge priced onto
//! the heap.
use super::super::chains::{buckets_for, position_key, Chains};
use super::super::Vertex;
use super::{edge_key, Collapser, Edge, Triangles, LOCKED, MARK};
use rayon::prelude::*;
use trillion3d_math::heap::IndexedHeap;

impl Collapser {
    /// The collapser of the triangles `indices` over `vertices`.
    pub(super) fn new(vertices: Vec<Vertex>, indices: &[u32]) -> Self {
        let count = vertices.len();
        let corners: Vec<[u32; 3]> = indices.as_chunks::<3>().0.to_vec();
        let mut vertex_triangles = vec![Triangles::new(); count];
        for (t, corner) in corners.iter().enumerate() {
            for &v in corner {
                vertex_triangles[v as usize].push(t as u32);
            }
        }
        let ids: Vec<u32> = (0..count as u32).collect();
        let triangles = corners.len();
        let mut collapser = Collapser {
            vertices,
            vertex_next: ids.clone(),
            vertex_prev: ids,
            vertex_flags: vec![0; count],
            vertex_triangles,
            corners,
            triangle_flags: vec![0; triangles],
            edges: Vec::new(),
            edge_chains: Chains::new(1, 0),
            heap: IndexedHeap::new(0),
            vertex_quadrics: vec![None; count],
            triangle_quadrics: vec![None; triangles],
            boundary_quadrics: vec![None; count],
            touched_triangles: Vec::new(),
            touched_vertices: Vec::new(),
            touched_edges: Vec::new(),
            live_vertices: count as i32,
            live_triangles: triangles as i32,
        };
        collapser.ring_vertices();
        collapser.list_edges();
        collapser.ring_edges();
        let mut chains = Chains::new(buckets_for(count), collapser.edges.len());
        for (e, edge) in collapser.edges.iter().enumerate() {
            chains.add(edge_key(edge.ends[0], edge.ends[1]), e as u32);
        }
        collapser.edge_chains = chains;
        collapser.heap = IndexedHeap::new(collapser.edges.len());
        collapser
    }

    /// Each vertex not yet ringed given every other vertex of its bucket at exactly its position,
    /// each put right after it as the bucket's chain reaches it.
    fn ring_vertices(&mut self) {
        let count = self.vertices.len();
        let keys: Vec<u32> = self
            .vertices
            .par_iter()
            .map(|v| position_key(v.position))
            .collect();
        let mut chains = Chains::new(buckets_for(count / 2), count);
        for (v, &key) in keys.iter().enumerate() {
            chains.add(key, v as u32);
        }
        for v in 0..count as u32 {
            if self.vertex_next[v as usize] != v {
                continue;
            }
            for w in chains.chain(keys[v as usize]) {
                if w != v && self.position(v) == self.position(w) {
                    let next = self.vertex_next[v as usize];
                    self.vertex_next[w as usize] = next;
                    self.vertex_prev[w as usize] = v;
                    let next = self.vertex_next[w as usize];
                    self.vertex_prev[next as usize] = w;
                    let prev = self.vertex_prev[w as usize];
                    self.vertex_next[prev as usize] = w;
                }
            }
        }
    }

    /// An edge from each vertex to each later one its triangles reach, alone in its ring.
    fn list_edges(&mut self) {
        let ends: Vec<[u32; 2]> = (0..self.vertices.len() as u32)
            .flat_map(|v| {
                self.around(v)
                    .into_iter()
                    .filter(move |&w| v < w)
                    .map(move |w| [v, w])
            })
            .collect();
        self.edges = (ends.into_iter().enumerate())
            .map(|(e, ends)| Edge {
                ends,
                next: e as u32,
                prev: e as u32,
                flags: 0,
            })
            .collect();
    }

    /// Each edge not yet ringed given the others joining its two positions, in its bucket's
    /// chain of the positions' keys combined either way round.
    fn ring_edges(&mut self) {
        let count = self.edges.len();
        let vertices = &self.vertices;
        let keys: Vec<u32> = (self.edges.par_iter())
            .map(|edge| {
                let [a, b] = edge
                    .ends
                    .map(|v| position_key(vertices[v as usize].position));
                edge_key(a, b)
            })
            .collect();
        let mut chains = Chains::new(buckets_for(count / 2), count);
        for (e, &key) in keys.iter().enumerate() {
            chains.add(key, e as u32);
        }
        for e in 0..count as u32 {
            if self.edges[e as usize].next != e {
                continue;
            }
            for other in chains.chain(keys[e as usize]) {
                if other != e {
                    self.match_edge(e, other);
                }
            }
        }
    }

    /// `e2` put into `e1`'s ring right after it when both join the same two vertices or the same
    /// two positions, turned first when it runs the other way.
    pub(super) fn match_edge(&mut self, e1: u32, e2: u32) {
        let [a1, b1] = self.edges[e1 as usize].ends;
        let [a2, b2] = self.edges[e2 as usize].ends;
        let [pa1, pb1, pa2, pb2] = [a1, b1, a2, b2].map(|v| self.position(v));
        let same = (a1 == a2 && b1 == b2) || (pa1 == pa2 && pb1 == pb2);
        let reversed = (a1 == b2 && b1 == a2) || (pa1 == pb2 && pb1 == pa2);
        if reversed {
            self.edges[e2 as usize].ends = [b2, a2];
        }
        if same || reversed {
            let next = self.edges[e1 as usize].next;
            self.edges[e2 as usize].next = next;
            self.edges[e2 as usize].prev = e1;
            let next = self.edges[e2 as usize].next;
            self.edges[next as usize].prev = e2;
            let prev = self.edges[e2 as usize].prev;
            self.edges[prev as usize].next = e2;
        }
    }

    /// Both rings of every edge exactly one triangle borders locked: for each vertex, each later
    /// one `around_ring` reaches, the triangles of the first ring that no triangle of the second
    /// shares counted.
    pub(super) fn lock_boundary(&mut self) {
        for v in 0..self.vertices.len() as u32 {
            for w in self.around_ring(v) {
                if v >= w {
                    continue;
                }
                self.mark_ring_triangles(v, MARK, true);
                self.mark_ring_triangles(w, MARK, false);
                let faces: usize = (self.vertex_ring(v).iter())
                    .map(|&member| {
                        (self.vertex_triangles[member as usize].iter())
                            .filter(|&&t| !self.triangle_has(t, MARK))
                            .count()
                    })
                    .sum();
                self.mark_ring_triangles(v, MARK, false);
                if faces == 1 {
                    self.mark_ring(v, LOCKED, true);
                    self.mark_ring(w, LOCKED, true);
                }
            }
        }
    }

    /// Every edge priced and put on the heap, in edge order.
    pub(super) fn price_all(&mut self) {
        for e in 0..self.edges.len() as u32 {
            let cost = self.collapse_cost(e);
            self.heap.insert(e, cost);
        }
    }
}
