//! The collapse simplifier: each vertex with its position and normal, its triangles and the ring
//! of vertices at its position (a seam of normals splits a point into several); each triangle with
//! its corners; each edge with its two ends and the ring of edges joining the same two positions;
//! the table of edges by their ends' ids, the heap of their collapse costs, the cached quadrics,
//! and the elements the last collapses touched. A collapse takes a whole ring of edges at once, so
//! the vertices at a point move together and a seam stays closed.
//!
//! The steps live in `build` (the rings, the edges, the locked boundary, the first costs), `price`
//! (the quadrics, the vertices a collapse leaves and its cost), `collapse` (one edge's collapse and
//! the gathering of what it touches), `refresh` (the touched triangles, vertices and edges brought
//! up to date) and `run` (the loop, the last sweep and the output).
//!
//! Every list keeps the order the steps leave it in — a vertex loses a triangle by moving its last
//! into the slot, a touched list takes each element at its first touch, a ring takes a vertex or
//! an edge right after the one it joins — and every walk follows it: those orders decide which of
//! two equal costs collapses first, which vertices a collapse moves and which vertex an output
//! corner names. Each element keeps four flags: removed, two scratch marks a step sets and clears
//! before it ends, and locked.
use super::chains::{murmur3_32, Chains};
use super::quadric::{NormalQuadric, PlaneQuadric};
use super::{Soup, Stop, Vertex};
use smallvec::SmallVec;
use trillion3d_math::heap::{IndexedHeap, LeastRightUnlessLeftLess};

mod build;
mod collapse;
mod price;
mod refresh;
mod run;

/// An element taken out of the mesh.
const REMOVED: u8 = 1;
/// The scratch mark a step sets on vertices or triangles and clears before it ends.
const MARK: u8 = 2;
/// The second scratch mark: the vertices about the one whose touched elements are gathered.
const NEAR: u8 = 4;
/// A vertex that does not move: one end of a boundary edge, or joined to one by a collapse.
const LOCKED: u8 = 8;

/// A vertex's triangles in the order they joined it, eight held in place.
type Triangles = SmallVec<[u32; 8]>;
/// The vertices or edges of a ring, from the one it is walked from on.
type Ring = SmallVec<[u32; 8]>;
/// The vertices a vertex's triangles reach, in the order they first appear.
type Around = SmallVec<[u32; 64]>;

/// An edge: its two ends, its neighbours in its ring, its flags.
struct Edge {
    ends: [u32; 2],
    next: u32,
    prev: u32,
    flags: u8,
}

struct Collapser {
    vertices: Vec<Vertex>,
    /// Each vertex's neighbours in the ring of vertices at its position.
    vertex_next: Vec<u32>,
    vertex_prev: Vec<u32>,
    vertex_flags: Vec<u8>,
    vertex_triangles: Vec<Triangles>,
    corners: Vec<[u32; 3]>,
    triangle_flags: Vec<u8>,
    edges: Vec<Edge>,
    /// Every edge not taken out, by `edge_key` of its ends.
    edge_chains: Chains,
    /// The edges still to collapse, by cost.
    heap: IndexedHeap<LeastRightUnlessLeftLess>,
    /// The cached quadrics, `None` once out of date: each vertex's (its triangles' sum), each
    /// triangle's, each vertex's boundary edges'.
    vertex_quadrics: Vec<Option<NormalQuadric>>,
    triangle_quadrics: Vec<Option<NormalQuadric>>,
    boundary_quadrics: Vec<Option<PlaneQuadric>>,
    /// What the collapses since the last refresh touched, each at its first touch.
    touched_triangles: Vec<u32>,
    touched_vertices: Vec<u32>,
    touched_edges: Vec<u32>,
    /// The vertices and triangles not taken out.
    live_vertices: i32,
    live_triangles: i32,
}

/// `mesh` simplified until `stop`, its vertices compacted in the order its triangles first name
/// them. With `seams`, the vertices on a boundary are locked first and the output ids of the
/// locked vertices listed in `seams`, which is emptied first. A mesh without vertices or without
/// triangles is left as it is.
pub(super) fn simplify(mesh: &mut Soup, stop: &Stop, mut seams: Option<&mut Vec<u32>>) {
    if let Some(seams) = seams.as_deref_mut() {
        seams.clear();
    }
    if mesh.vertices.is_empty() || mesh.indices.is_empty() {
        return;
    }
    let mut collapser = Collapser::new(std::mem::take(&mut mesh.vertices), &mesh.indices);
    mesh.indices = Vec::new();
    if seams.is_some() {
        collapser.lock_boundary();
    }
    collapser.price_all();
    collapser.run(stop);
    *mesh = collapser.live_soup(seams);
}

/// `flag` set on `flags` when `on`, cleared otherwise.
fn set(flags: &mut u8, flag: u8, on: bool) {
    if on {
        *flags |= flag;
    } else {
        *flags &= !flag;
    }
}

/// `t` taken out of `list` at its first slot, the last entry moved into it.
fn remove_once(list: &mut Triangles, t: u32) {
    if let Some(at) = list.iter().position(|&x| x == t) {
        list.swap_remove(at);
    }
}

/// The table key of the edge between vertices `a` and `b` — or between two positions' keys —,
/// either way round.
fn edge_key(a: u32, b: u32) -> u32 {
    murmur3_32(&[a.min(b), a.max(b)])
}

impl Collapser {
    fn position(&self, v: u32) -> [f32; 3] {
        self.vertices[v as usize].position
    }

    fn vertex_has(&self, v: u32, flag: u8) -> bool {
        self.vertex_flags[v as usize] & flag != 0
    }

    fn triangle_has(&self, t: u32, flag: u8) -> bool {
        self.triangle_flags[t as usize] & flag != 0
    }

    fn edge_has(&self, e: u32, flag: u8) -> bool {
        self.edges[e as usize].flags & flag != 0
    }

    fn mark_vertex(&mut self, v: u32, flag: u8, on: bool) {
        set(&mut self.vertex_flags[v as usize], flag, on);
    }

    fn mark_triangle(&mut self, t: u32, flag: u8, on: bool) {
        set(&mut self.triangle_flags[t as usize], flag, on);
    }

    /// The vertices of `v`'s ring, from `v` on.
    fn vertex_ring(&self, v: u32) -> Ring {
        let mut ring = Ring::new();
        let mut at = v;
        loop {
            ring.push(at);
            at = self.vertex_next[at as usize];
            if at == v {
                return ring;
            }
        }
    }

    /// The vertices of `u`'s ring, then those of `v`'s.
    fn joint_ring(&self, u: u32, v: u32) -> Ring {
        self.vertex_ring(u)
            .into_iter()
            .chain(self.vertex_ring(v))
            .collect()
    }

    /// The edges of `e`'s ring, from `e` on.
    fn edge_ring(&self, e: u32) -> Ring {
        let mut ring = Ring::new();
        let mut at = e;
        loop {
            ring.push(at);
            at = self.edges[at as usize].next;
            if at == e {
                return ring;
            }
        }
    }

    /// `flag` set or cleared on every vertex of `v`'s ring.
    fn mark_ring(&mut self, v: u32, flag: u8, on: bool) {
        for w in self.vertex_ring(v) {
            self.mark_vertex(w, flag, on);
        }
    }

    /// `flag` set or cleared on every corner of `v`'s triangles, `v` among them.
    fn mark_around(&mut self, v: u32, flag: u8, on: bool) {
        for &t in &self.vertex_triangles[v as usize] {
            for w in self.corners[t as usize] {
                set(&mut self.vertex_flags[w as usize], flag, on);
            }
        }
    }

    /// `flag` set or cleared on `v`'s triangles.
    fn mark_triangles(&mut self, v: u32, flag: u8, on: bool) {
        for &t in &self.vertex_triangles[v as usize] {
            set(&mut self.triangle_flags[t as usize], flag, on);
        }
    }

    /// `flag` set or cleared on the triangles of every vertex of `v`'s ring.
    fn mark_ring_triangles(&mut self, v: u32, flag: u8, on: bool) {
        for w in self.vertex_ring(v) {
            self.mark_triangles(w, flag, on);
        }
    }

    /// The corners of `v`'s triangles other than `v`, in the order they first appear.
    fn around(&self, v: u32) -> Around {
        let mut found = Around::new();
        for &t in &self.vertex_triangles[v as usize] {
            for w in self.corners[t as usize] {
                if w != v && !found.contains(&w) {
                    found.push(w);
                }
            }
        }
        found
    }

    /// `around` over `v`'s ring: for each member, the corners of `v`'s own triangles other than
    /// that member — the triangles read are `v`'s for every member, a quirk of the method kept as
    /// it decides the order, so a ring of several members lists `v` itself.
    fn around_ring(&self, v: u32) -> Around {
        let mut found = Around::new();
        for member in self.vertex_ring(v) {
            for &t in &self.vertex_triangles[v as usize] {
                for w in self.corners[t as usize] {
                    if w != member && !found.contains(&w) {
                        found.push(w);
                    }
                }
            }
        }
        found
    }

    /// `v` taken out of its ring, alone in its own.
    fn unlink_vertex(&mut self, v: u32) {
        let (prev, next) = (self.vertex_prev[v as usize], self.vertex_next[v as usize]);
        self.vertex_next[prev as usize] = next;
        let (prev, next) = (self.vertex_prev[v as usize], self.vertex_next[v as usize]);
        self.vertex_prev[next as usize] = prev;
        self.vertex_next[v as usize] = v;
        self.vertex_prev[v as usize] = v;
    }

    /// `e` taken out of its ring, alone in its own.
    fn unlink_edge(&mut self, e: u32) {
        let Edge { prev, next, .. } = self.edges[e as usize];
        self.edges[prev as usize].next = next;
        let Edge { prev, next, .. } = self.edges[e as usize];
        self.edges[next as usize].prev = prev;
        self.edges[e as usize].next = e;
        self.edges[e as usize].prev = e;
    }

    /// The edge between `a` and `b` either way round, the newest filed first.
    fn edge_between(&self, a: u32, b: u32) -> Option<u32> {
        self.edge_chains.chain(edge_key(a, b)).find(|&e| {
            let [x, y] = self.edges[e as usize].ends;
            (x == a && y == b) || (x == b && y == a)
        })
    }
}
