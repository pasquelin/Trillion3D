//! The triangle soup the tessellation refines: vertices as rows of floats — a position, then every
//! attribute the mesh carries, all of them blended alike where a vertex is made between others —,
//! triangles as corners, a material for each, and the half edges across each edge. A triangle's edge
//! `e` runs from its corner `e` to its corner `(e + 1) % 3`, and its half edge is `3 · triangle + e`.
//!
//! The mesh may be a soup — triangles that share no vertex number but meet at a position —, so the
//! half edges are paired by the positions of their ends, an edge's partner the latest edge made
//! the other way round between the same two points that has none yet. A pair that shares its two
//! vertex numbers is a manifold edge, the only one a flip may turn.
use super::settings::EdgeSplit;
use std::collections::HashMap;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, scale, sub};

/// The half edge `offset` edges past `half` in its triangle.
pub(super) fn cycle3(half: usize, offset: usize) -> usize {
    half - half % 3 + (half + offset) % 3
}

/// The bits of a coordinate, a zero of either sign the same.
fn bits(x: f32) -> u32 {
    if x == 0.0 {
        0
    } else {
        x.to_bits()
    }
}

/// `v` made unit, left alone when it is already, zero when it is nearly nothing.
fn safe_normal(v: [f32; 3]) -> [f32; 3] {
    let squared = dot(v, v);
    if squared == 1.0 {
        v
    } else if squared < 1.0e-8 {
        [0.0; 3]
    } else {
        scale(v, 1.0 / squared.sqrt())
    }
}

/// The soup and its adjacency.
pub(super) struct Soup {
    pub(super) rows: Vec<f32>,
    pub(super) stride: usize,
    /// Where in a row each texture set's two floats start.
    pub(super) uv_sets: Vec<usize>,
    pub(super) indices: Vec<u32>,
    pub(super) materials: Vec<i32>,
    /// Per half edge, the half edge across it, negative on a border.
    pub(super) adjacent: Vec<i32>,
    pub(super) split: EdgeSplit,
}

impl Soup {
    /// The soup of the vertex `rows` of `stride` floats, whose first three are the position and
    /// whose texture sets start at `uv_sets`, and of the triangles `indices`, `materials` each.
    pub(super) fn new(
        (rows, stride): (Vec<f32>, usize),
        uv_sets: Vec<usize>,
        (indices, materials): (Vec<u32>, Vec<i32>),
        split: EdgeSplit,
    ) -> Self {
        let mut soup = Self {
            rows,
            stride,
            uv_sets,
            adjacent: vec![-1; indices.len()],
            indices,
            materials,
            split,
        };
        soup.pair_edges();
        soup
    }

    /// The coordinates of both ends of `half`, as bits.
    fn ends(&self, half: usize) -> [u32; 6] {
        let from = self.position(self.indices[half]);
        let to = self.position(self.indices[cycle3(half, 1)]);
        [from[0], from[1], from[2], to[0], to[1], to[2]].map(bits)
    }

    /// Pairs each half edge with the latest earlier one that runs between the same two positions
    /// the other way and has no partner yet, both then paired. The edges still waiting, by the
    /// positions of their ends, are kept latest last.
    fn pair_edges(&mut self) {
        let mut waiting: HashMap<[u32; 6], Vec<usize>> = HashMap::new();
        for half in 0..self.indices.len() {
            let ends = self.ends(half);
            let reverse = [ends[3], ends[4], ends[5], ends[0], ends[1], ends[2]];
            match waiting.get_mut(&reverse).and_then(Vec::pop) {
                Some(other) => {
                    self.adjacent[half] = other as i32;
                    self.adjacent[other] = half as i32;
                }
                None => waiting.entry(ends).or_default().push(half),
            }
        }
    }

    /// The vertices.
    pub(super) fn vertex_count(&self) -> usize {
        self.rows.len() / self.stride
    }

    /// The triangles.
    pub(super) fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// The row of `vertex`.
    pub(super) fn row(&self, vertex: u32) -> &[f32] {
        &self.rows[vertex as usize * self.stride..][..self.stride]
    }

    /// The position of `vertex`.
    pub(super) fn position(&self, vertex: u32) -> [f32; 3] {
        let row = self.row(vertex);
        [row[0], row[1], row[2]]
    }

    /// Moves `vertex` to `position`.
    pub(super) fn set_position(&mut self, vertex: usize, position: [f32; 3]) {
        self.rows[vertex * self.stride..][..3].copy_from_slice(&position);
    }

    /// The vertices of `triangle`.
    pub(super) fn triangle(&self, triangle: usize) -> [u32; 3] {
        let at = triangle * 3;
        [self.indices[at], self.indices[at + 1], self.indices[at + 2]]
    }

    /// The positions of the corners of `triangle`.
    pub(super) fn corners(&self, triangle: usize) -> [[f32; 3]; 3] {
        self.triangle(triangle).map(|vertex| self.position(vertex))
    }

    /// The material of `triangle`.
    pub(super) fn material(&self, triangle: usize) -> i32 {
        self.materials[triangle]
    }

    /// The triangle across edge `edge` of `triangle`, none on a border.
    pub(super) fn across(&self, triangle: usize, edge: usize) -> Option<usize> {
        usize::try_from(self.adjacent[triangle * 3 + edge])
            .ok()
            .map(|half| half / 3)
    }

    /// The triangle and the edge across edge `edge` of `triangle`, none on a border.
    pub(super) fn across_edge(&self, triangle: usize, edge: usize) -> Option<(usize, usize)> {
        usize::try_from(self.adjacent[triangle * 3 + edge])
            .ok()
            .map(|half| (half / 3, half % 3))
    }

    /// Whether the triangles on both sides of the edge name the same two vertices, so that the
    /// edge may be flipped: true on a border, where there is no other side.
    pub(super) fn manifold(&self, triangle: usize, edge: usize) -> bool {
        let half = triangle * 3 + edge;
        let Ok(across) = usize::try_from(self.adjacent[half]) else {
            return true;
        };
        self.indices[half] == self.indices[cycle3(across, 1)]
            && self.indices[cycle3(half, 1)] == self.indices[across]
    }

    /// The unit normal of `triangle`, zero where it has none.
    pub(super) fn normal(&self, triangle: usize) -> [f32; 3] {
        let [p0, p1, p2] = self.corners(triangle);
        safe_normal(cross(sub(p1, p0), sub(p0, p2)))
    }

    /// Whether two vertices carry the same coordinates in every texture set.
    pub(super) fn identical_uvs(&self, a: u32, b: u32) -> bool {
        a == b
            || self
                .uv_sets
                .iter()
                .all(|&at| self.row(a)[at..at + 2] == self.row(b)[at..at + 2])
    }

    /// The rows of the vertices and the triangles' corners.
    pub(super) fn into_parts(self) -> (Vec<f32>, Vec<u32>) {
        (self.rows, self.indices)
    }
}
