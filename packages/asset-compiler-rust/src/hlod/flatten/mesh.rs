//! The one triangle mesh the HLOD steps edit: its triangles, edges and vertices numbered by ids,
//! each id counted by what holds it and freed when nothing does, the last freed the next taken
//! (`ids`):
//!
//! - a triangle appended takes each side's edge, made the first time a triangle names it —
//!   `(a, b)`, `(b, c)`, `(c, a)` — and is refused when it names a vertex twice, sits on a side
//!   two triangles hold already, or repeats a held triangle's corners (`Refusal`);
//! - each vertex keeps its edges in the order they are visited: its first `IN_ORDER` edges in the
//!   order made, every later one after them, the last made first; an edge taken away leaves the
//!   others in their order, so the first past `IN_ORDER` moves up when an earlier one goes;
//! - a vertex's triangles are visited edge by edge, each edge's triangles that leave the vertex
//!   along it, its first triangle before its second (`triangles_at`);
//! - a triangle or a vertex taken away and an edge split (`edit`), an edge collapsed
//!   (`collapse`), each rewiring its neighbours' links (`links`) and taking and freeing ids as
//!   above; the boundary walked into loops and spans (`boundary`), a loop through a bowtie split
//!   into simple ones (`subloops`).
//!
//! The edge a vertex met first, the boundary and the order it is walked in, a vertex's neighbours
//! and the order a front visits them all follow from the order the triangles came in and the edits
//! made since. The mesh holds no point: a caller keeps its own by vertex id.
mod boundary;
mod collapse;
mod edit;
mod ids;
mod links;
mod subloops;
pub(crate) use boundary::{boundary_loops, plane_angle, Boundaries};
pub(crate) use edit::Split;
use ids::Ids;

/// A side no second triangle holds; an id none names.
pub(crate) const NONE: usize = usize::MAX;

/// How many of a vertex's edges are visited in the order they were made; the later ones are then
/// visited from the last made back.
const IN_ORDER: usize = 8;

/// An edge: its two ends, the lower first, and the two triangles that hold it, the second `NONE` on
/// the boundary.
pub(crate) struct Edge {
    pub(crate) ends: [usize; 2],
    pub(crate) faces: [usize; 2],
}

/// Why a triangle was not appended.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Refusal {
    /// It names a vertex twice.
    Degenerate,
    /// One of its sides is held by two triangles already.
    NonManifold,
    /// Its three sides are held, the first by a triangle of its third corner: the same triangle.
    Duplicate,
}

/// The triangles and edges by id — a freed one's slot keeping what it last held until its id is
/// taken again —, each triangle's three edges, each vertex's edges in visiting order, and the ids
/// of the three kinds.
#[derive(Default)]
pub(crate) struct Mesh {
    pub(crate) triangles: Vec<[usize; 3]>,
    pub(crate) edges: Vec<Edge>,
    sides: Vec<[usize; 3]>,
    around: Vec<Vec<usize>>,
    vertex_ids: Ids,
    triangle_ids: Ids,
    edge_ids: Ids,
}

/// `item` stored at `id`: one past the last slot for a new id, a freed one's slot for a taken one.
fn place<T>(items: &mut Vec<T>, id: usize, item: T) {
    match items.get_mut(id) {
        Some(slot) => *slot = item,
        None => items.push(item),
    }
}

impl Mesh {
    /// A mesh of `count` vertices and no triangle.
    pub(crate) fn with_vertices(count: usize) -> Self {
        let mut mesh = Self::default();
        for _ in 0..count {
            mesh.add_vertex();
        }
        mesh
    }

    /// A new vertex, its id: the last freed, else one past the last, its edge list empty.
    pub(crate) fn add_vertex(&mut self) -> usize {
        let v = self.vertex_ids.take();
        match self.around.get_mut(v) {
            Some(edges) => edges.clear(),
            None => self.around.push(Vec::new()),
        }
        v
    }

    /// How many vertex ids the mesh has made: those no triangle names and the freed among them.
    pub(crate) fn vertex_count(&self) -> usize {
        self.vertex_ids.made()
    }

    /// Whether vertex `v` stands: taken and not freed since.
    pub(crate) fn is_vertex(&self, v: usize) -> bool {
        self.vertex_ids.holds(v)
    }

    /// Whether triangle `t` stands.
    pub(crate) fn is_triangle(&self, t: usize) -> bool {
        self.triangle_ids.holds(t)
    }

    /// Whether edge `e` stands.
    pub(crate) fn is_edge(&self, e: usize) -> bool {
        self.edge_ids.holds(e)
    }

    /// The edge between `a` and `b`, if one stands: the first of the lower end's edges, in visiting
    /// order, whose higher end is the other; none between a vertex and itself.
    pub(crate) fn find_edge(&self, a: usize, b: usize) -> Option<usize> {
        if a == b {
            return None;
        }
        let (low, high) = (a.min(b), a.max(b));
        self.edges_at(low).find(|&e| self.edges[e].ends[1] == high)
    }

    /// `tri` appended, its id; why not when it is refused (`Refusal`). Its corners are standing
    /// vertices, each counted up; each side takes its edge, the ones not made yet made in turn.
    pub(crate) fn append(&mut self, tri: [usize; 3]) -> Result<usize, Refusal> {
        if tri[0] == tri[1] || tri[0] == tri[2] || tri[1] == tri[2] {
            return Err(Refusal::Degenerate);
        }
        let found = [0, 1, 2].map(|k| self.find_edge(tri[k], tri[(k + 1) % 3]));
        if found.iter().flatten().any(|&e| !self.is_boundary(e)) {
            return Err(Refusal::NonManifold);
        }
        if let [Some(e), Some(_), Some(_)] = found {
            if self.triangles[self.edges[e].faces[0]].contains(&tri[2]) {
                return Err(Refusal::Duplicate);
            }
        }
        let t = self.add_triangle(tri, [NONE; 3]);
        for v in tri {
            self.vertex_ids.count_up(v, 1);
        }
        for k in 0..3 {
            let side = match found[k] {
                Some(e) => {
                    self.edges[e].faces[1] = t;
                    e
                }
                None => self.add_edge(tri[k], tri[(k + 1) % 3], [t, NONE]),
            };
            self.sides[t][k] = side;
        }
        Ok(t)
    }

    /// A triangle of corners `tri` and edges `sides` stored under a new id, the id; no vertex is
    /// counted and no edge told.
    fn add_triangle(&mut self, tri: [usize; 3], sides: [usize; 3]) -> usize {
        let t = self.triangle_ids.take();
        place(&mut self.triangles, t, tri);
        place(&mut self.sides, t, sides);
        t
    }

    /// A new edge between `a` and `b` held by `faces`, its id, listed by its lower end then its
    /// higher one.
    fn add_edge(&mut self, a: usize, b: usize, faces: [usize; 2]) -> usize {
        let ends = [a.min(b), a.max(b)];
        let e = self.edge_ids.take();
        place(&mut self.edges, e, Edge { ends, faces });
        self.link(ends[0], e);
        self.link(ends[1], e);
        e
    }

    /// Edge `e` listed by vertex `v`: at the end while `v` lists fewer than `IN_ORDER`, else first
    /// of those past them.
    fn link(&mut self, v: usize, e: usize) {
        let edges = &mut self.around[v];
        edges.insert(edges.len().min(IN_ORDER), e);
    }

    /// Edge `e` taken from vertex `v`'s list, the others kept in their order.
    fn unlink(&mut self, v: usize, e: usize) {
        let edges = &mut self.around[v];
        if let Some(at) = edges.iter().position(|&x| x == e) {
            edges.remove(at);
        }
    }

    /// Whether only one triangle holds edge `e`.
    pub(crate) fn is_boundary(&self, e: usize) -> bool {
        self.edges[e].faces[1] == NONE
    }

    /// The triangles across triangle `t`'s three sides, in its corners' order, `NONE` on the
    /// boundary.
    pub(crate) fn neighbour_triangles(&self, t: usize) -> [usize; 3] {
        self.sides[t].map(|e| {
            let [a, b] = self.edges[e].faces;
            if a == t {
                b
            } else {
                a
            }
        })
    }

    /// Vertex `v`'s edges in the order they are visited (module doc).
    pub(crate) fn edges_at(&self, v: usize) -> impl Iterator<Item = usize> + '_ {
        self.around[v].iter().copied()
    }

    /// Vertex `v`'s neighbours, its edges' other ends in the order the edges are visited.
    pub(crate) fn neighbours(&self, v: usize) -> impl Iterator<Item = usize> + '_ {
        self.edges_at(v).map(move |e| self.other(e, v))
    }

    /// The end of edge `e` other than `v`.
    pub(crate) fn other(&self, e: usize, v: usize) -> usize {
        let [a, b] = self.edges[e].ends;
        if a == v {
            b
        } else {
            a
        }
    }

    /// The first edge vertex `v` visits — the one it met first while none was taken from it —,
    /// none when it has no edge.
    pub(crate) fn first_edge(&self, v: usize) -> Option<usize> {
        self.around[v].first().copied()
    }

    /// Boundary edge `e`'s ends in the order its triangle winds them.
    pub(crate) fn oriented(&self, e: usize) -> [usize; 2] {
        let Edge { ends, faces } = &self.edges[e];
        let tri = self.triangles[faces[0]];
        let k = (0..3)
            .find(|&k| {
                let (a, b) = (tri[k], tri[(k + 1) % 3]);
                [a.min(b), a.max(b)] == *ends
            })
            .unwrap_or(0);
        [tri[k], tri[(k + 1) % 3]]
    }

    /// Vertex `v`'s triangles: each edge's in visiting order, the first triangle then the second of
    /// those that wind from `v` to the edge's other end — each triangle once, by the one side
    /// leaving `v`.
    pub(crate) fn triangles_at(&self, v: usize) -> impl Iterator<Item = usize> + '_ {
        self.edges_at(v).flat_map(move |e| {
            let to = self.other(e, v);
            let [first, second] = self.edges[e].faces;
            let first = self.winds(first, v, to).then_some(first);
            let second = (second != NONE && self.winds(second, v, to)).then_some(second);
            first.into_iter().chain(second)
        })
    }

    /// Whether triangle `t` winds from `a` straight to `b`.
    fn winds(&self, t: usize, a: usize, b: usize) -> bool {
        let [x, y, z] = self.triangles[t];
        (x == a && y == b) || (y == a && z == b) || (z == a && x == b)
    }
}
