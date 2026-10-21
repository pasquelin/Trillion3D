//! The triangulation's mesh: every triangle held as its three directed edges, each edge mapped to
//! the corner opposite it (its apex), triangles turning counter-clockwise. The hull is closed by
//! ghost triangles joining each hull edge, reversed, to one ghost vertex (`GHOST`), so every edge
//! has a triangle on both sides.
//!
//! The edges live in slots: a removed edge frees its slot, and the next new edge takes the slot
//! freed last, or a new slot at the end when none is free. Walking the mesh's edges walks the
//! slots in order — which decides the triangles' output order and the edges the vertex ring
//! (below) remembers, so it is kept exactly. Re-adding an edge already present only replaces its
//! apex in place.
//!
//! Once started (`start_ring`), a ring remembers for each vertex one edge leaving it, set by every
//! triangle added and cleared when the triangle holding that edge goes, so finding a triangle
//! around a vertex (`edge_around`) seldom walks the slots. Vertices rejected as duplicates of
//! another are mapped to the vertex kept (`resolve`).
use std::collections::HashMap;

/// The vertex every ghost triangle shares, beyond the hull.
pub(super) const GHOST: i32 = -1;
/// No vertex: the apex of an edge not in the mesh, or a triangle not found.
pub(super) const ABSENT: i32 = -2;

/// The mesh (module doc).
pub(super) struct EdgeMesh {
    /// Each slot's directed edge and apex, `None` once freed.
    slots: Vec<Option<([i32; 2], i32)>>,
    /// The freed slots, the last freed on top.
    freed: Vec<usize>,
    /// The slot of each directed edge in the mesh.
    slot_of: HashMap<[i32; 2], usize>,
    /// Whether the ring is kept.
    ring_on: bool,
    /// For each vertex shifted by one (the ghost at 0), the far end of an edge leaving it, shifted
    /// by one; `ABSENT + 1` when unknown.
    ring: Vec<i32>,
    /// The vertex kept for each vertex rejected as its duplicate.
    kept_for: HashMap<i32, i32>,
}

impl EdgeMesh {
    /// An empty mesh, without a ring.
    pub(super) fn new() -> Self {
        Self {
            slots: Vec::new(),
            freed: Vec::new(),
            slot_of: HashMap::new(),
            ring_on: false,
            ring: Vec::new(),
            kept_for: HashMap::new(),
        }
    }

    /// `edge` mapped to `apex`: in place when present, else in the slot freed last or a new one.
    fn put(&mut self, edge: [i32; 2], apex: i32) {
        if let Some(&slot) = self.slot_of.get(&edge) {
            self.slots[slot] = Some((edge, apex));
            return;
        }
        let slot = match self.freed.pop() {
            Some(slot) => {
                self.slots[slot] = Some((edge, apex));
                slot
            }
            None => {
                self.slots.push(Some((edge, apex)));
                self.slots.len() - 1
            }
        };
        self.slot_of.insert(edge, slot);
    }

    /// `edge` taken out, its slot freed; nothing when absent.
    fn evict(&mut self, edge: [i32; 2]) {
        if let Some(slot) = self.slot_of.remove(&edge) {
            self.slots[slot] = None;
            self.freed.push(slot);
        }
    }

    /// The ring's index of `vertex`.
    fn ring_index(vertex: i32) -> usize {
        (vertex + 1) as usize
    }

    /// The triangle `[a, b, c]` added, its edges `ab`, `bc`, `ca` in that order; the ring, when
    /// kept, remembers each edge from its first corner.
    pub(super) fn place_triangle(&mut self, [a, b, c]: [i32; 3]) {
        self.put([a, b], c);
        self.put([b, c], a);
        self.put([c, a], b);
        if self.ring_on {
            self.ring[Self::ring_index(a)] = b + 1;
            self.ring[Self::ring_index(b)] = c + 1;
            self.ring[Self::ring_index(c)] = a + 1;
        }
    }

    /// The first triangle, counter-clockwise, and the three ghost triangles behind its edges.
    pub(super) fn start_with_ghosts(&mut self, [a, b, c]: [i32; 3]) {
        self.place_triangle([a, b, c]);
        self.place_triangle([b, a, GHOST]);
        self.place_triangle([c, b, GHOST]);
        self.place_triangle([a, c, GHOST]);
    }

    /// The triangle `[a, b, c]` taken out, edges `ab`, `bc`, `ca`; the ring, when kept, forgets
    /// each of them it remembered.
    pub(super) fn remove_triangle(&mut self, [a, b, c]: [i32; 3]) {
        self.evict([a, b]);
        self.evict([b, c]);
        self.evict([c, a]);
        if self.ring_on {
            for (from, to) in [(a, b), (b, c), (c, a)] {
                if self.ring[Self::ring_index(from)] == to + 1 {
                    self.ring[Self::ring_index(from)] = ABSENT + 1;
                }
            }
        }
    }

    /// The apex of the directed `edge`, `ABSENT` when the edge is not in the mesh.
    pub(super) fn apex(&self, edge: [i32; 2]) -> i32 {
        self.slot_of
            .get(&edge)
            .and_then(|&slot| self.slots[slot])
            .map_or(ABSENT, |(_, apex)| apex)
    }

    /// Whether the directed `edge` is in the mesh.
    pub(super) fn holds_edge(&self, edge: [i32; 2]) -> bool {
        self.slot_of.contains_key(&edge)
    }

    /// The triangles in the mesh, ghosts included.
    pub(super) fn triangle_count(&self) -> usize {
        self.slot_of.len() / 3
    }

    /// The ring started for `vertex_count` vertices when not kept yet: every vertex unknown, then
    /// each edge in slot order remembered from its first vertex (the last one leaving a vertex
    /// wins).
    pub(super) fn start_ring(&mut self, vertex_count: usize) {
        if self.ring_on {
            return;
        }
        self.ring_on = true;
        self.ring = vec![ABSENT + 1; vertex_count + 1];
        for &(edge, _) in self.slots.iter().flatten() {
            self.ring[Self::ring_index(edge[0])] = edge[1] + 1;
        }
    }

    /// The edge opposite `vertex` in a triangle around it, `[ABSENT, ABSENT]` when none: from the
    /// ring when it remembers an edge leaving the vertex, else the first such edge in slot order,
    /// the ring remembering every edge walked on the way. Called once the ring is started.
    pub(super) fn edge_around(&mut self, vertex: i32) -> [i32; 2] {
        let next = self.ring[Self::ring_index(vertex)] - 1;
        if next != ABSENT {
            return [next, self.apex([vertex, next])];
        }
        for &(edge, apex) in self.slots.iter().flatten() {
            self.ring[Self::ring_index(edge[0])] = edge[1] + 1;
            if edge[0] == vertex {
                return [edge[1], apex];
            }
        }
        [ABSENT, ABSENT]
    }

    /// `duplicate` rejected for lying on `kept`.
    pub(super) fn mark_duplicate(&mut self, kept: i32, duplicate: i32) {
        self.kept_for.insert(duplicate, kept);
    }

    /// `edge` with each end rejected as a duplicate replaced by the vertex kept.
    pub(super) fn resolve(&self, [a, b]: [i32; 2]) -> [i32; 2] {
        let kept = |vertex: i32| self.kept_for.get(&vertex).copied().unwrap_or(vertex);
        [kept(a), kept(b)]
    }

    /// The solid triangles, each once — read from the edge whose apex is its least corner, as
    /// `[edge start, edge end, apex]`, in slot order — and for each its neighbours: `[i][k]` the
    /// triangle across its edge from corner `k` to corner `k + 1`, `-1` when none (a hull edge).
    pub(super) fn triangles_with_neighbours(&self) -> (Vec<[i32; 3]>, Vec<[i32; 3]>) {
        let triangles: Vec<[i32; 3]> = self
            .slots
            .iter()
            .flatten()
            .filter(|&&([a, b], apex)| {
                a != GHOST && b != GHOST && apex != GHOST && apex < a && apex < b
            })
            .map(|&([a, b], apex)| [a, b, apex])
            .collect();
        let mut neighbours = vec![[-1; 3]; triangles.len()];
        // Each directed edge whose reverse was not met yet, to its triangle and the corner it
        // leaves (the corner of the edge's start, its corners being distinct).
        let mut open: HashMap<[i32; 2], (usize, usize)> = HashMap::new();
        for (index, triangle) in triangles.iter().enumerate() {
            for (from, to) in [(2, 0), (0, 1), (1, 2)] {
                match open.remove(&[triangle[to], triangle[from]]) {
                    Some((other, corner)) => {
                        neighbours[other][corner] = index as i32;
                        neighbours[index][from] = other as i32;
                    }
                    None => {
                        open.insert([triangle[from], triangle[to]], (index, from));
                    }
                }
            }
        }
        (triangles, neighbours)
    }
}
