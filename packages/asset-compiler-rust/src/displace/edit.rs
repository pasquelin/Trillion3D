//! The edits the tessellation makes to the soup (`Soup`): a vertex added between others, an edge
//! split, a triangle poked, an edge flipped. Each keeps the half edges paired across the triangles
//! it makes or changes.
use super::mesh::{cycle3, Soup};
use super::settings::EdgeSplit;

/// What splitting an edge made: the triangles it split (`old`), the triangles it added
/// (`new`, beside each), and the vertex added on each side — one where the two sides share it.
/// `count` is 2 for an edge between two triangles, 1 for a border.
#[derive(Clone, Copy, Debug)]
pub(super) struct EdgeSplitInfo {
    pub old: [usize; 2],
    pub new: [usize; 2],
    pub vertex: [usize; 2],
    pub count: usize,
}

/// What poking a triangle made: the three triangles round the vertex added — the first the
/// triangle itself — and the vertex.
#[derive(Clone, Copy, Debug)]
pub(super) struct PokeInfo {
    pub triangles: [usize; 3],
    pub vertex: usize,
}

impl Soup {
    /// Adds the vertex that is each of the rows `from` weighed by its weight, summed in order, and
    /// returns its number.
    pub(super) fn add_vertex(&mut self, from: &[(u32, f32)]) -> usize {
        let (first, rest) = from
            .split_first()
            .expect("a vertex is made of at least one");
        let mut row: Vec<f32> = self.row(first.0).iter().map(|x| x * first.1).collect();
        for &(vertex, weight) in rest {
            for (sum, x) in row.iter_mut().zip(self.row(vertex)) {
                *sum += x * weight;
            }
        }
        let added = self.vertex_count();
        self.rows.extend_from_slice(&row);
        added
    }

    /// Pairs half edge `half` with `other`, a negative one a border.
    fn link(&mut self, half: usize, other: i32) {
        self.adjacent[half] = other;
        if let Ok(other) = usize::try_from(other) {
            self.adjacent[other] = half as i32;
        }
    }

    /// Splits edge `edge` of `triangle` at `weight` of its first end and the rest of its second:
    /// a vertex is added there, and each triangle on the edge's sides becomes two. The vertex is
    /// one for both sides unless the mesh duplicates it (`EdgeSplit::AlwaysDuplicate`) or a
    /// material or a texture coordinate differs across the edge (a seam).
    pub(super) fn split_edge(
        &mut self,
        triangle: usize,
        edge: usize,
        weight: f32,
    ) -> EdgeSplitInfo {
        let (from, to) = (
            self.triangle(triangle)[edge],
            self.triangle(triangle)[(edge + 1) % 3],
        );
        let first = self.add_vertex(&[(from, weight), (to, 1.0 - weight)]);
        let own = triangle * 3 + edge;
        let across = usize::try_from(self.adjacent[own]).ok();
        let count = if across.is_some() { 2 } else { 1 };
        let halves = [own, across.unwrap_or(0)];
        let old = [triangle, halves[1] / 3];
        let added = self.triangle_count();
        let new = [added, added + 1];
        let seam = across.is_some_and(|other| {
            self.materials[old[0]] != self.materials[old[1]]
                || !self.identical_uvs(self.indices[own], self.indices[cycle3(other, 1)])
                || !self.identical_uvs(self.indices[other], self.indices[cycle3(own, 1)])
        });
        let shared = self.split == EdgeSplit::Seams && !seam;
        let (mut vertex, mut index) = ([first; 2], first);
        for j in 0..count {
            let (e0, e1, e2) = (halves[j], cycle3(halves[j], 1), cycle3(halves[j], 2));
            let (index0, index1, index2) = (self.indices[e0], self.indices[e1], self.indices[e2]);
            let (adjacent1, adjacent2) = (self.adjacent[e1], self.adjacent[e2]);
            if j == 1 && !shared {
                index = self.add_vertex(&[(index1, weight), (index0, 1.0 - weight)]);
                vertex[1] = index;
            }
            self.indices.extend([0; 3]);
            self.adjacent.extend([-1; 3]);
            self.materials.push(self.materials[old[j]]);
            let (other_new, other_old) = match count {
                2 => ((new[j ^ 1] * 3) as i32, (old[j ^ 1] * 3) as i32),
                _ => (-1, -1),
            };
            // The old triangle keeps its far corner and the second end, the new one the first end.
            let at = old[j] * 3;
            self.indices[at..at + 3].copy_from_slice(&[index as u32, index1, index2]);
            self.adjacent[at] = other_new;
            self.link(at + 1, adjacent1);
            self.adjacent[at + 2] = (new[j] * 3 + 1) as i32;
            let at = new[j] * 3;
            self.indices[at..at + 3].copy_from_slice(&[index0, index as u32, index2]);
            self.adjacent[at] = other_old;
            self.adjacent[at + 1] = (old[j] * 3 + 2) as i32;
            self.link(at + 2, adjacent2);
        }
        EdgeSplitInfo {
            old,
            new,
            vertex,
            count,
        }
    }

    /// Pokes `triangle`: a vertex is added at the barycentric weights `bary` of its corners and
    /// joined to the three, the triangle becoming three.
    pub(super) fn poke(&mut self, triangle: usize, bary: [f32; 3]) -> PokeInfo {
        let corners = self.triangle(triangle);
        let weighed = [
            (corners[0], bary[0]),
            (corners[1], bary[1]),
            (corners[2], bary[2]),
        ];
        let vertex = self.add_vertex(&weighed);
        let at = triangle * 3;
        let old = [
            self.adjacent[at],
            self.adjacent[at + 1],
            self.adjacent[at + 2],
        ];
        let added = self.triangle_count();
        let triangles = [triangle, added, added + 1];
        self.indices.extend([0; 6]);
        self.adjacent.extend([-1; 6]);
        let material = self.materials[triangle];
        self.materials.extend([material; 2]);
        for e in 0..3 {
            let (e1, e2) = ((e + 1) % 3, (e + 2) % 3);
            let at = triangles[e] * 3;
            self.indices[at..at + 3].copy_from_slice(&[corners[e], corners[e1], vertex as u32]);
            self.link(at, old[e]);
            self.adjacent[at + 1] = (triangles[e1] * 3 + 2) as i32;
            self.adjacent[at + 2] = (triangles[e2] * 3 + 1) as i32;
        }
        PokeInfo { triangles, vertex }
    }

    /// Flips edge `edge` of `triangle`, which has a triangle across it: the two triangles share the
    /// other diagonal of their quad, as their edge 0. Returns them.
    pub(super) fn flip(&mut self, triangle: usize, edge: usize) -> [usize; 2] {
        let half = triangle * 3 + edge;
        let across = usize::try_from(self.adjacent[half]);
        let across = across.expect("a flipped edge has a triangle across it");
        let other = across / 3;
        let a = triangle * 3 + (half + 2) % 3;
        let b = other * 3 + (across + 1) % 3;
        let c = other * 3 + (across + 2) % 3;
        let d = triangle * 3 + (half + 1) % 3;
        let [index_a, index_b, index_c, index_d] = [a, b, c, d].map(|h| self.indices[h]);
        let halves = [a, b, c, d];
        let [adjacent_a, adjacent_b, adjacent_c, adjacent_d] = halves.map(|h| self.adjacent[h]);
        let (at, other_at) = (triangle * 3, other * 3);
        self.indices[at..at + 3].copy_from_slice(&[index_c, index_a, index_b]);
        self.indices[other_at..other_at + 3].copy_from_slice(&[index_a, index_c, index_d]);
        self.link(at, other_at as i32);
        self.link(at + 1, adjacent_a);
        self.link(at + 2, adjacent_b);
        self.link(other_at + 1, adjacent_c);
        self.link(other_at + 2, adjacent_d);
        [triangle, other]
    }
}
