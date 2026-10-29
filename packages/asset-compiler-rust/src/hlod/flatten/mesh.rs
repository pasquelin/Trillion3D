//! The one triangle mesh the HLOD steps edit: its triangles, edges and vertices numbered by ids,
//! each id counted by what holds it and freed when nothing does, the last freed the next taken
//! (`ids`):
//!
//! - a triangle appended takes each side's edge, made the first time a triangle names it —
//!   `(a, b)`, `(b, c)`, `(c, a)` — and is refused when it names a vertex twice, sits on a side
//!   two triangles hold already, or repeats a held triangle's corners (`Refusal`);
//! - each vertex lists its edges in the order they are visited: the first `in_order` in the order
//!   made, every later one placed right after those, so ahead of the ones listed past them — the
//!   last made comes first past `in_order`. `Mesh::with_vertices` sets `in_order` to `IN_ORDER`
//!   (8); `Mesh::shrinking` sets it to never, so every edge goes last, in the order made. An edge
//!   taken away leaves the others in their order, so the first past `in_order` moves up when an
//!   earlier one goes;
//! - a vertex's triangles are visited edge by edge, each edge's triangles that leave the vertex
//!   along it, its first triangle before its second (`triangles_at`);
//! - a triangle or a vertex taken away and an edge split (`edit`), an edge collapsed
//!   (`collapse`, which tells why it refuses), each rewiring its neighbours' links (`links`) and
//!   taking and freeing ids as above; the building blocks (`build`); the boundary walked into loops and spans (`boundary`), a loop through a bowtie split
//!   into simple ones (`subloops`).
//!
//! The edge a vertex met first, the boundary and the order it is walked in, a vertex's neighbours
//! and the order a front visits them all follow from the order the triangles came in and the edits
//! made since. The mesh holds no point: a caller keeps its own by vertex id.
mod boundary;
mod build;
mod collapse;
mod edit;
mod ids;
mod links;
mod subloops;
pub(crate) use boundary::{boundary_loops, plane_angle, Boundaries};
pub(crate) use collapse::Refused;
pub(crate) use edit::Split;
use ids::Ids;
use smallvec::SmallVec;

/// The id in a link that names nothing, as the links hold it: a side no second triangle holds.
const NO_LINK: u32 = u32::MAX;
/// A side no second triangle holds; an id none names. Ids are held in thirty-two bits and read as
/// words, so it is the word a link holds for none.
pub(crate) const NONE: usize = NO_LINK as usize;

/// How many of a vertex's edges are visited in the order they were made; the later ones are then
/// visited from the last made back.
const IN_ORDER: usize = 8;

/// An edge: its two ends, the lower first, and the two triangles that hold it, the second `NONE` on
/// the boundary.
pub(crate) struct Edge {
    ends: [u32; 2],
    faces: [u32; 2],
}

/// A vertex's edges, eight held in place: no allocation of its own for almost every vertex.
type Around = SmallVec<[u32; 8]>;

/// `ids` read as words.
fn words<const N: usize>(ids: [u32; N]) -> [usize; N] {
    ids.map(|id| id as usize)
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
/// of the three kinds. Ids are held in thirty-two bits.
pub(crate) struct Mesh {
    pub(crate) triangles: Vec<[u32; 3]>,
    pub(crate) edges: Vec<Edge>,
    sides: Vec<[u32; 3]>,
    around: Vec<Around>,
    /// How many of a vertex's edges are visited in the order they were made.
    in_order: usize,
    vertex_ids: Ids,
    triangle_ids: Ids,
    edge_ids: Ids,
}

impl Mesh {
    /// How many vertex ids the mesh has made: those no triangle names and the freed among them.
    pub(crate) fn vertex_count(&self) -> usize {
        self.vertex_ids.made()
    }

    /// Whether vertex `v` stands: taken and not freed since. A vertex's count is sixteen bits
    /// (`ids`) and wraps with the triangles that name it: past 65 534 of them the answer is not
    /// to be trusted, and an edit that would count it up should ask `Ids::crowded` first.
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

    /// How many triangles stand.
    pub(crate) fn triangle_count(&self) -> usize {
        self.triangle_ids.standing()
    }

    /// Triangle `t`'s corners.
    pub(crate) fn corners(&self, t: usize) -> [usize; 3] {
        words(self.triangles[t])
    }

    /// Edge `e`'s ends, the lower first.
    pub(crate) fn ends(&self, e: usize) -> [usize; 2] {
        words(self.edges[e].ends)
    }

    /// Triangle `t`'s edges, the side on each pair of consecutive corners in turn.
    fn sides_of(&self, t: usize) -> [usize; 3] {
        words(self.sides[t])
    }

    /// The triangles that hold edge `e`, the second `NONE` on the boundary.
    pub(crate) fn faces(&self, e: usize) -> [usize; 2] {
        words(self.edges[e].faces)
    }

    /// Whether only one triangle holds edge `e`.
    pub(crate) fn is_boundary(&self, e: usize) -> bool {
        self.edges[e].faces[1] == NO_LINK
    }

    /// The triangles across triangle `t`'s three sides, in its corners' order, `NONE` on the
    /// boundary.
    pub(crate) fn neighbour_triangles(&self, t: usize) -> [usize; 3] {
        self.sides_of(t).map(|e| {
            let [a, b] = self.faces(e);
            if a == t {
                b
            } else {
                a
            }
        })
    }

    /// Vertex `v`'s edges in the order they are visited (module doc).
    pub(crate) fn edges_at(&self, v: usize) -> impl Iterator<Item = usize> + '_ {
        self.around[v].iter().map(|&e| e as usize)
    }

    /// Vertex `v`'s neighbours, its edges' other ends in the order the edges are visited.
    pub(crate) fn neighbours(&self, v: usize) -> impl Iterator<Item = usize> + '_ {
        self.edges_at(v).map(move |e| self.other(e, v))
    }

    /// The end of edge `e` other than `v`.
    pub(crate) fn other(&self, e: usize, v: usize) -> usize {
        let [a, b] = self.ends(e);
        if a == v {
            b
        } else {
            a
        }
    }

    /// The first edge vertex `v` visits — the one it met first while none was taken from it —,
    /// none when it has no edge.
    pub(crate) fn first_edge(&self, v: usize) -> Option<usize> {
        self.around[v].first().map(|&e| e as usize)
    }

    /// Boundary edge `e`'s ends in the order its triangle winds them.
    pub(crate) fn oriented(&self, e: usize) -> [usize; 2] {
        let ends = self.ends(e);
        let tri = self.corners(self.faces(e)[0]);
        let k = (0..3)
            .find(|&k| {
                let (a, b) = (tri[k], tri[(k + 1) % 3]);
                [a.min(b), a.max(b)] == ends
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
            let [first, second] = self.faces(e);
            let first = self.winds(first, v, to).then_some(first);
            let second = (second != NONE && self.winds(second, v, to)).then_some(second);
            first.into_iter().chain(second)
        })
    }

    /// Whether triangle `t` winds from `a` straight to `b`.
    fn winds(&self, t: usize, a: usize, b: usize) -> bool {
        let [x, y, z] = self.corners(t);
        (x == a && y == b) || (y == a && z == b) || (z == a && x == b)
    }
}
