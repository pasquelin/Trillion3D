//! Keeping the mesh sound around a collapse: a triangle's quadric recomputed, a degenerate or
//! repeated triangle removed, vertices equal in every float made one, a border edge's quadric
//! recomputed, and the largest triangle kept aside for a simplification that would leave none.
use super::{attributes, position, Backup, Simplifier, EDGE_WEIGHT, NONE, P};
use crate::simplify::region::quadric::{self, EdgeQuadric};
use trillion3d_math::geometry::triangle::{facing, next_corner, prev_corner};

impl Simplifier {
    /// The quadric of triangle `tri` from its vertices as they are now.
    pub(crate) fn calc_tri_quadric(&mut self, tri: usize) {
        let (m, size) = (self.m, quadric::size(self.m));
        let v = [0, 1, 2].map(|k| self.indexes[tri * 3 + k]);
        let verts = &self.verts;
        quadric::triangle(
            &mut self.tri_quadrics[tri * size..(tri + 1) * size],
            v.map(|x| quadric::wide(position(verts, m, x))),
            v.map(|x| attributes(verts, m, x)),
            &self.weights,
        );
    }

    /// The quadric of the edge from corner `edge` to the next corner of its triangle: none when a
    /// triangle of the same material runs it back between the same two vertices; else the
    /// distance to its line, weighted twice its length — halved when a triangle runs it back
    /// between other vertices at the same positions, an attribute seam whose twin counts too.
    pub(crate) fn calc_edge_quadric(&mut self, edge: usize) {
        let tri = edge / 3;
        if self.tri_removed[tri] {
            self.edge_valid[edge] = false;
            return;
        }
        let material = self.materials[tri];
        let (v0, v1) = (self.indexes[edge], self.indexes[next_corner(edge)]);
        let (p0, p1) = (self.position(v0), self.position(v1));
        let twin = (self.corner_hash.at(p1).iter().rev()).any(|&corner| {
            let c = corner as usize;
            let (o0, o1) = (self.indexes[c], self.indexes[next_corner(c)]);
            v0 == o1 && v1 == o0 && material == self.materials[c / 3]
        });
        if twin {
            self.edge_valid[edge] = false;
            return;
        }
        let seam = self.runs_back(p0, p1);
        let weight = if seam { EDGE_WEIGHT * 0.5 } else { EDGE_WEIGHT };
        self.edge_quadrics[edge] = EdgeQuadric::new(quadric::wide(p0), quadric::wide(p1), weight);
        self.edge_valid[edge] = true;
    }

    /// The corner of triangle `tri` the collapse moves, 3 for none and 4 for more than one.
    fn corner_moved(&self, tri: usize) -> usize {
        let mut moved = 3;
        for k in 0..3 {
            if self.corner_flags[tri * 3 + k] & super::MERGE_MASK != 0 {
                moved = if moved == 3 { k } else { 4 };
            }
        }
        moved
    }

    /// The positions of triangle `tri`'s corners in winding order from the one corner the
    /// collapse moves: that corner, the next, the last; none when it moves none or more than one.
    pub(crate) fn moved_wedge(&self, tri: usize) -> Option<[P; 3]> {
        let moved = self.corner_moved(tri);
        if moved >= 3 {
            return None;
        }
        let corner = tri * 3 + moved;
        let corners = [corner, next_corner(corner), prev_corner(corner)];
        Some(corners.map(|c| self.position(self.indexes[c])))
    }

    /// Whether moving the one corner of triangle `tri` the collapse moves to `p` turns it around.
    pub(crate) fn tri_will_invert(&self, tri: usize, p: P) -> bool {
        let Some([p0, p1, p2]) = self.moved_wedge(tri) else {
            return false;
        };
        facing([p1, p0, p2], 1, p) < 0.0
    }

    /// Removes triangle `tri`: its corners leave the lists and release their vertices.
    pub(crate) fn remove_tri(&mut self, tri: usize) {
        self.tri_removed[tri] = true;
        self.remaining_tris -= 1;
        for k in 0..3 {
            let corner = tri * 3 + k;
            let p = self.position(self.indexes[corner]);
            self.corner_hash.remove(p, corner as u32);
            self.edge_valid[corner] = false;
            self.set_vert_index(corner, NONE);
        }
    }

    /// After a collapse: triangle `tri` goes if two of its corners share a position, or, its
    /// vertices made one with any equal vertex, if it repeats another triangle; else its quadric
    /// is computed afresh.
    pub(crate) fn fix_up_tri(&mut self, tri: usize) {
        let [p0, p1, p2] = [0, 1, 2].map(|k| self.position(self.indexes[tri * 3 + k]));
        let mut remove = p0 == p1 || p1 == p2 || p2 == p0;
        if !remove {
            for k in 0..3 {
                self.remove_duplicate_verts(tri * 3 + k);
            }
            remove = self.is_duplicate_tri(tri);
        }
        if remove {
            self.remove_tri(tri);
        } else {
            self.calc_tri_quadric(tri);
        }
    }

    /// Whether another corner names triangle `tri`'s three vertices in its order.
    fn is_duplicate_tri(&self, tri: usize) -> bool {
        let i = [0, 1, 2].map(|k| self.indexes[tri * 3 + k]);
        (self.corner_hash.at(self.position(i[0])).iter().rev()).any(|&corner| {
            let c = corner as usize;
            c != tri * 3
                && i[0] == self.indexes[c]
                && i[1] == self.indexes[next_corner(c)]
                && i[2] == self.indexes[prev_corner(c)]
        })
    }

    /// Points corner `corner` at vertex `vert` (`NONE` for none), a vertex no corner names any
    /// more leaving the lists.
    pub(crate) fn set_vert_index(&mut self, corner: usize, vert: u32) {
        let old = self.indexes[corner];
        if old == vert {
            return;
        }
        self.vert_refs[old as usize] -= 1;
        if self.vert_refs[old as usize] == 0 {
            let p = self.position(old);
            self.vert_hash.remove(p, old);
            self.remaining_verts -= 1;
        }
        self.indexes[corner] = vert;
        if vert != NONE {
            self.vert_refs[vert as usize] += 1;
        }
    }

    /// Points corner `corner` at the vertex equal to its own in every float that was listed after
    /// it at its position, the newest such: equal vertices are one.
    fn remove_duplicate_verts(&mut self, corner: usize) {
        let vert = self.indexes[corner];
        let stride = self.stride();
        let own = vert as usize * stride;
        let verts = &self.verts;
        let found = (self.vert_hash.at(self.position(vert)).iter().rev())
            .take_while(|&&other| other != vert)
            .find(|&&other| {
                let at = other as usize * stride;
                (0..stride).all(|i| verts[own + i] == verts[at + i])
            })
            .copied();
        if let Some(other) = found {
            self.set_vert_index(corner, other);
        }
    }

    /// Keeps triangle `tri`, of area `area`, aside: its three vertices and its material.
    pub(crate) fn capture_backup(&mut self, tri: usize, area: f32) {
        let stride = self.stride();
        let mut floats = Vec::with_capacity(3 * stride);
        for k in 0..3 {
            let at = self.indexes[tri * 3 + k] as usize * stride;
            floats.extend_from_slice(&self.verts[at..at + stride]);
        }
        self.backup = Some(Backup {
            floats,
            material: self.materials[tri],
            area,
        });
    }

    /// Puts the triangle kept aside back as the first triangle on the first three vertices, the
    /// error rising to the area lost.
    pub(crate) fn restore_backup(&mut self, max_error: &mut f32) {
        let Some(backup) = self.backup.take() else {
            return;
        };
        let stride = self.stride();
        for k in 0..3 {
            self.verts[k * stride..(k + 1) * stride]
                .copy_from_slice(&backup.floats[k * stride..(k + 1) * stride]);
            self.vert_refs[k] = 1;
            self.indexes[k] = k as u32;
        }
        self.materials[0] = backup.material;
        self.tri_removed[0] = false;
        self.remaining_verts = 3;
        self.remaining_tris = 1;
        self.calc_tri_quadric(0);
        let lost = (self.total_area - backup.area).max(0.0);
        *max_error = max_error.max(lost);
    }
}
