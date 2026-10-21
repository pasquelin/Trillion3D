//! Keeping a thin shape's area (`SolveRules::keep_area`): once a solve is done, the material whose
//! collapses lost the most area has its open border pushed outwards by what it lost, so leaves,
//! blades and other thin pieces keep their coverage as they simplify.
//!
//! **The border.** Every live triangle of that material walks its edges; an edge with a border
//! quadric that no live triangle runs back between the same two positions is open. Its outward
//! normal in the triangle's plane — the triangle's normal crossed with the edge, made unit —
//! weighted by the edge's length is added, with that length, to every vertex at each of its two
//! positions that is not locked. The open edges' lengths sum to the border's perimeter.
//!
//! **The push.** The area lost over the perimeter is how far the border moves. Each vertex whose
//! summed length exceeds 1e-6, in vertex order, draws a factor in [0.75, 1.25) from a stream
//! seeded by the count of open edges (`Fractions`); its mean normal, divided by that normal's
//! squared length when it exceeds 0.1, moves it by the distance times the factor. A material that
//! lost more than four times the area it has left moves nothing: a few gigantic pieces would show
//! more than the area lost. Nor does one with no open border, or one of no length: no vertex holds
//! a length then.
use super::{Simplifier, LOCKED};
use crate::simplify::region::prepare::MATERIAL_MASK;
use crate::simplify::region::quadric;
use crate::simplify::unit_or_same;
use trillion3d_math::geometry::triangle::next_corner;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{add, length, scale, squared_length, sub};

/// The fractions the push draws: the state stepped `x ← 196 314 165·x + 907 633 515` on 32 bits,
/// its top 23 bits a fraction in [0, 1).
struct Fractions(u32);
impl Fractions {
    fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_mul(196_314_165).wrapping_add(907_633_515);
        f32::from_bits(0x3F80_0000 | (self.0 >> 9)) - 1.0
    }
}

impl Simplifier {
    /// Pushes the open border of the material that lost the most area outwards by what it lost
    /// (the module's rule); nothing when no material lost any, as none counts its area unless
    /// the solve keeps it (`Input::keep_area`).
    pub fn keep_area(&mut self) {
        let mut thinned: Option<(usize, f32)> = None;
        for (material, &change) in self.area_change.iter().enumerate() {
            if change < thinned.map_or(0.0, |(_, least)| least) {
                thinned = Some((material, change));
            }
        }
        let Some((material, lost)) = thinned else {
            return;
        };
        let size = quadric::size(self.m);
        // Per vertex, the sum of its weighted normals and the sum of their lengths.
        let mut normals = vec![([0.0_f32; 3], 0.0_f32); self.vert_refs.len()];
        let (mut perimeter, mut kept_area, mut open_edges) = (0.0_f32, 0.0_f32, 0u32);
        for tri in 0..self.tri_removed.len() {
            if self.tri_removed[tri] || (self.materials[tri] & MATERIAL_MASK) as usize != material {
                continue;
            }
            kept_area += self.tri_quadrics[tri * size + quadric::AREA] as f32;
            let corners = [0, 1, 2].map(|k| self.position(self.indexes[tri * 3 + k]));
            let [a, b, c] = corners;
            let face = cross(sub(c, a), sub(b, a));
            for k in 0..3 {
                let edge = tri * 3 + k;
                let next = next_corner(edge);
                let (p0, p1) = (corners[k], corners[(k + 1) % 3]);
                if !self.edge_valid[edge] || self.runs_back(p0, p1) {
                    continue;
                }
                open_edges += 1;
                let along = sub(p1, p0);
                let outward = cross(face, along);
                let normal = unit_or_same(outward);
                let edge_length = length(along);
                perimeter += edge_length;
                let weighted = scale(normal, edge_length);
                for (end, p) in [(edge, p0), (next, p1)] {
                    if self.corner_flags[end] & LOCKED != 0 {
                        continue;
                    }
                    for &vert in self.vert_hash.at(p) {
                        let (sum, weight) = &mut normals[vert as usize];
                        *sum = add(*sum, weighted);
                        *weight += edge_length;
                    }
                }
            }
        }
        // No open border, or one of no length, gives no vertex a length: nothing would move, and
        // the distance over a perimeter of zero is no number.
        if -lost > 4.0 * kept_area || perimeter <= 0.0 {
            return;
        }
        let distance = -lost / perimeter;
        let mut fractions = Fractions(open_edges);
        let stride = self.stride();
        for (vert, &(sum, weight)) in normals.iter().enumerate() {
            if weight > 1e-6 {
                let factor = fractions.next() * 0.5 + 0.75;
                let normal = scale(sum, 1.0 / weight);
                let length2 = squared_length(normal);
                if length2 > 0.1 {
                    let push = factor * distance / length2;
                    let moved = add(self.position(vert as u32), scale(normal, push));
                    self.verts[vert * stride..vert * stride + 3].copy_from_slice(&moved);
                }
            }
        }
    }
}
