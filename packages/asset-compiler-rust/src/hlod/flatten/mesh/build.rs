//! The mesh built: made empty or with vertices, a vertex added, a triangle appended with the edges
//! it makes, an edge found, an edge listed by its ends and unlisted.
use super::{Around, Edge, Ids, Mesh, Refusal, IN_ORDER, NONE};

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
        Self::of(
            count,
            IN_ORDER,
            [Ids::default(), Ids::default(), Ids::default()],
        )
    }

    /// A mesh of `count` vertices and no triangle that is only shrunk once built: a vertex lists
    /// its edges in the order they came whatever their number, and no freed id is kept to be
    /// taken again.
    pub(crate) fn shrinking(count: usize) -> Self {
        let ids = || Ids::discarding();
        Self::of(count, usize::MAX, [ids(), ids(), ids()])
    }

    fn of(count: usize, in_order: usize, [vertex_ids, triangle_ids, edge_ids]: [Ids; 3]) -> Self {
        let mut mesh = Mesh {
            triangles: Vec::new(),
            edges: Vec::new(),
            sides: Vec::new(),
            around: Vec::new(),
            in_order,
            vertex_ids,
            triangle_ids,
            edge_ids,
        };
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
            None => self.around.push(Around::new()),
        }
        v
    }

    /// The edge between `a` and `b`, if one stands; none between a vertex and itself. The edge is
    /// the only one between them, found in the shorter of their two lists: building a mesh costs
    /// the sum over its edges of the fewer edges of their two ends, which a surface keeps within a
    /// few times its edge count however many a vertex lists (a fan's apex lists them all, its rim
    /// vertices three).
    pub(crate) fn find_edge(&self, a: usize, b: usize) -> Option<usize> {
        if a == b {
            return None;
        }
        let (from, to) = if self.around[a].len() <= self.around[b].len() {
            (a, b)
        } else {
            (b, a)
        };
        self.edges_at(from).find(|&e| self.other(e, from) == to)
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
            if self.corners(self.faces(e)[0]).contains(&tri[2]) {
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
                    self.edges[e].faces[1] = t as u32;
                    e
                }
                None => self.add_edge(tri[k], tri[(k + 1) % 3], [t, NONE]),
            };
            self.sides[t][k] = side as u32;
        }
        Ok(t)
    }

    /// A triangle of corners `tri` and edges `sides` stored under a new id, the id; no vertex is
    /// counted and no edge told.
    pub(super) fn add_triangle(&mut self, tri: [usize; 3], sides: [usize; 3]) -> usize {
        let t = self.triangle_ids.take();
        place(&mut self.triangles, t, tri.map(|v| v as u32));
        place(&mut self.sides, t, sides.map(|e| e as u32));
        t
    }

    /// A new edge between `a` and `b` held by `faces`, its id, listed by its lower end then its
    /// higher one.
    pub(super) fn add_edge(&mut self, a: usize, b: usize, faces: [usize; 2]) -> usize {
        let ends = [a.min(b), a.max(b)];
        let e = self.edge_ids.take();
        let edge = Edge {
            ends: ends.map(|v| v as u32),
            faces: faces.map(|t| t as u32),
        };
        place(&mut self.edges, e, edge);
        self.link(ends[0], e);
        self.link(ends[1], e);
        e
    }

    /// Edge `e` listed by vertex `v`: at the end while `v` lists fewer than `in_order`, else first
    /// of those past them.
    pub(super) fn link(&mut self, v: usize, e: usize) {
        let edges = &mut self.around[v];
        edges.insert(edges.len().min(self.in_order), e as u32);
    }

    /// Edge `e` taken from vertex `v`'s list, the others kept in their order.
    pub(super) fn unlink(&mut self, v: usize, e: usize) {
        let edges = &mut self.around[v];
        if let Some(at) = edges.iter().position(|&x| x as usize == e) {
            edges.remove(at);
        }
    }
}
