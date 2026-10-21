//! The triangle mesh every stage of the chart builder reads: positions, texture coordinates and
//! corners, with what the stages ask of its topology.
//!
//! An edge is named by its first corner, `face · 3 + k`, and runs to the next corner of its face
//! (`edge_end`). The edge lookup keeps, per ordered pair of vertices, the edges between them newest
//! first, and skips the edges of ignored faces; when the mesh has colocals (vertices at the same
//! position, linked in rings in ascending order), a pair is also looked up through every
//! combination of their colocals. An edge's opposite is the edge found from its end back to its
//! start; an edge with none is on the boundary, and so are its two vertices. A seam is an edge
//! whose opposite was only found through colocals.
use super::grid::Corners;
use super::vector::{signed_half_area, space_area, Vec2, Vec3};
use trillion3d_math::vector::vec3::{cross, unit_where};
use trillion3d_math::vector::vecn::{add, length, scale, sub};
use trillion3d_page_codec::hash::{word_map, WordMap};

/// No vertex, edge, face or chart.
pub(super) const NONE: usize = usize::MAX;

/// The face an edge belongs to.
#[inline]
pub(super) fn edge_face(edge: usize) -> usize {
    edge / 3
}

/// The corner an edge ends at: the next corner of its face.
#[inline]
pub(super) fn edge_end(edge: usize) -> usize {
    edge / 3 * 3 + (edge % 3 + 1) % 3
}

#[derive(Default)]
pub(super) struct TriMesh {
    pub(super) positions: Vec<Vec3>,
    pub(super) texcoords: Vec<Vec2>,
    /// Per corner, its vertex.
    pub(super) indices: Vec<usize>,
    /// Per face, whether it is set aside; empty on the meshes that never set one aside.
    pub(super) ignored: Vec<bool>,
    /// Per ordered vertex pair, its newest edge; per edge, the previous edge of its pair.
    edge_heads: WordMap<(usize, usize), usize>,
    edge_older: Vec<usize>,
    /// Per vertex, the next vertex of its colocal ring and the ring's least vertex; empty until
    /// `link_colocals`.
    next_colocal: Vec<usize>,
    colocal_root: Vec<usize>,
    /// Per edge, its opposite edge or `NONE`.
    opposite: Vec<usize>,
    pub(super) border_edges: Vec<usize>,
    boundary_vertex: Vec<bool>,
}

impl TriMesh {
    pub(super) fn add_vertex(&mut self, position: Vec3, texcoord: Vec2) {
        self.positions.push(position);
        self.texcoords.push(texcoord);
    }

    /// A face of the three vertices, its three edges recorded in the lookup.
    pub(super) fn add_face(&mut self, corners: [usize; 3]) {
        let first = self.indices.len();
        self.indices.extend_from_slice(&corners);
        for k in 0..3 {
            let key = (corners[k], corners[(k + 1) % 3]);
            let older = self.edge_heads.insert(key, first + k).unwrap_or(NONE);
            self.edge_older.push(older);
        }
    }

    #[inline]
    pub(super) fn face_count(&self) -> usize {
        self.indices.len() / 3
    }

    #[inline]
    pub(super) fn is_ignored(&self, face: usize) -> bool {
        !self.ignored.is_empty() && self.ignored[face]
    }

    /// The position of a corner's vertex.
    #[inline]
    pub(super) fn corner(&self, corner: usize) -> Vec3 {
        self.positions[self.indices[corner]]
    }

    /// The positions of a face's three corners.
    #[inline]
    pub(super) fn face_corners(&self, face: usize) -> [Vec3; 3] {
        [
            self.corner(face * 3),
            self.corner(face * 3 + 1),
            self.corner(face * 3 + 2),
        ]
    }

    /// The texture coordinates of a face's three corners.
    #[inline]
    pub(super) fn face_texcoords(&self, face: usize) -> [Vec2; 3] {
        [0, 1, 2].map(|k| self.texcoords[self.indices[face * 3 + k]])
    }

    /// Where the boundary grid reads the texture coordinates of the edges' ends.
    pub(super) fn uv_corners(&self) -> Corners<'_> {
        Corners::Indexed {
            positions: &self.texcoords,
            indices: &self.indices,
        }
    }

    /// The vertices an edge runs from and to.
    #[inline]
    pub(super) fn edge_vertices(&self, edge: usize) -> (usize, usize) {
        (self.indices[edge], self.indices[edge_end(edge)])
    }

    /// Links the vertices of bit-identical finite positions in rings of ascending ids, each vertex
    /// naming its ring's least; a vertex alone, or of a position not finite, is its own ring.
    pub(super) fn link_colocals(&mut self) {
        let count = self.positions.len();
        // Per vertex, the next vertex of the same bits: each position's chain, ascending from its
        // least vertex.
        let mut same_next = vec![NONE; count];
        let mut least: WordMap<[u32; 3], usize> = word_map(count);
        for vertex in (0..count).rev() {
            let bits = self.positions[vertex].map(f32::to_bits);
            same_next[vertex] = least.insert(bits, vertex).unwrap_or(NONE);
        }
        self.next_colocal = vec![NONE; count];
        self.colocal_root = vec![NONE; count];
        let mut ring = Vec::new();
        for vertex in 0..count {
            if self.next_colocal[vertex] != NONE {
                continue;
            }
            ring.clear();
            ring.push(vertex);
            // A finite position's least vertex links its whole chain, so a vertex reached unlinked
            // leads its chain.
            if self.positions[vertex].iter().all(|axis| axis.is_finite()) {
                let mut other = same_next[vertex];
                while other != NONE {
                    ring.push(other);
                    other = same_next[other];
                }
            }
            for (k, &member) in ring.iter().enumerate() {
                self.next_colocal[member] = ring[(k + 1) % ring.len()];
                self.colocal_root[member] = ring[0];
            }
        }
    }

    /// The least vertex of `vertex`'s colocal ring.
    #[inline]
    pub(super) fn colocal_root(&self, vertex: usize) -> usize {
        self.colocal_root[vertex]
    }

    /// The newest edge from `v0` to `v1` of a face kept, or `NONE`.
    fn kept_edge(&self, v0: usize, v1: usize) -> usize {
        let mut edge = self.edge_heads.get(&(v0, v1)).copied().unwrap_or(NONE);
        while edge != NONE {
            if !self.is_ignored(edge_face(edge)) {
                return edge;
            }
            edge = self.edge_older[edge];
        }
        NONE
    }

    /// An edge from `v0` to `v1`: the exact pair first, then every pair of their colocals.
    pub(super) fn edge_from(&self, v0: usize, v1: usize) -> usize {
        let edge = self.kept_edge(v0, v1);
        if edge != NONE || self.next_colocal.is_empty() {
            return edge;
        }
        let mut c0 = v0;
        loop {
            let mut c1 = v1;
            loop {
                let edge = self.kept_edge(c0, c1);
                if edge != NONE {
                    return edge;
                }
                c1 = self.next_colocal[c1];
                if c1 == v1 {
                    break;
                }
            }
            c0 = self.next_colocal[c0];
            if c0 == v0 {
                return NONE;
            }
        }
    }

    /// Every kept face's edges matched to their opposites; the edges with none listed as the
    /// boundary, their vertices marked.
    pub(super) fn match_opposites(&mut self) {
        let edge_count = self.indices.len();
        self.opposite = vec![NONE; edge_count];
        self.border_edges.clear();
        self.boundary_vertex = vec![false; self.positions.len()];
        for face in 0..edge_count / 3 {
            if self.is_ignored(face) {
                continue;
            }
            for edge in face * 3..face * 3 + 3 {
                let (v0, v1) = self.edge_vertices(edge);
                let opposite = self.edge_from(v1, v0);
                if opposite != NONE {
                    self.opposite[edge] = opposite;
                } else {
                    self.border_edges.push(edge);
                    self.boundary_vertex[v0] = true;
                    self.boundary_vertex[v1] = true;
                }
            }
        }
    }

    #[inline]
    pub(super) fn opposite(&self, edge: usize) -> usize {
        self.opposite[edge]
    }

    /// The face across an edge, `NONE` on the boundary.
    #[inline]
    pub(super) fn face_across(&self, edge: usize) -> usize {
        let opposite = self.opposite[edge];
        if opposite == NONE {
            NONE
        } else {
            edge_face(opposite)
        }
    }

    #[inline]
    pub(super) fn on_boundary(&self, vertex: usize) -> bool {
        self.boundary_vertex[vertex]
    }

    /// Whether an edge's opposite joins other vertices than its own (found through colocals).
    pub(super) fn joins_colocals(&self, edge: usize) -> bool {
        let opposite = self.opposite[edge];
        if opposite == NONE {
            return false;
        }
        self.indices[edge] != self.indices[edge_end(opposite)]
            || self.indices[edge_end(edge)] != self.indices[opposite]
    }

    pub(super) fn face_area(&self, face: usize) -> f32 {
        let [p0, p1, p2] = self.face_corners(face);
        space_area(p0, p1, p2)
    }

    /// The face's edge midpoints averaged with the edges' lengths as weights: a point inside the
    /// face, near its circumcentre.
    pub(super) fn face_center(&self, face: usize) -> Vec3 {
        let [p0, p1, p2] = self.face_corners(face);
        let (l0, l1, l2) = (
            length(sub(p1, p0)),
            length(sub(p2, p1)),
            length(sub(p0, p2)),
        );
        let total = l0 + l1 + l2;
        let m0 = scale(scale(add(p0, p1), l0), 1.0 / total);
        let m1 = scale(scale(add(p1, p2), l1), 1.0 / total);
        let m2 = scale(scale(add(p2, p0), l2), 1.0 / total);
        add(add(m0, m1), m2)
    }

    /// The unit normal `(p2 − p0) × (p1 − p0)`, `+z` for a face of no area (a NaN length
    /// included).
    pub(super) fn face_normal(&self, face: usize) -> Vec3 {
        let [p0, p1, p2] = self.face_corners(face);
        unit_where(cross(sub(p2, p0), sub(p1, p0)), |l| l > 0.0).unwrap_or([0.0, 0.0, 1.0])
    }

    /// Half the signed area of a face's texture triangle, positive counter-clockwise, rounded as
    /// `signed_half_area` rounds it: its corners taken relative to the third.
    pub(super) fn uv_area_from_third(&self, face: usize) -> f32 {
        let [a, b, c] = self.face_texcoords(face);
        signed_half_area(a, b, c)
    }

    /// The faces' areas summed in order.
    pub(super) fn surface_area(&self) -> f32 {
        (0..self.face_count()).fold(0.0, |sum, face| sum + self.face_area(face))
    }

    /// The faces' texture areas summed in order, each counted positive.
    pub(super) fn uv_area(&self) -> f32 {
        (0..self.face_count()).fold(0.0, |sum, face| sum + self.uv_area_from_third(face).abs())
    }
}
