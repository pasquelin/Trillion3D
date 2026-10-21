//! How a patch takes a face and offers the faces across its front. A face added to the patch is
//! marked in it and in the patches as a whole, and every face across its edges that is in no patch,
//! not offered yet, not refused and whose third vertex is not yet in the patch becomes a candidate.
//!
//! An offered face is projected on its own plane (`flat_corners`), then scaled, moved and turned so
//! its shared edge lies on the patch's. It is refused, never offered to this patch again, when its
//! third vertex lands on a place that is not a number, or on the patch's side of the edge (read by
//! the orientation of the patch face's corner of the same rank, where the generator reads it), or
//! when its stretch (`area_balance`: the lesser of its texture and surface areas over the greater,
//! against the patch edge's vertices and the third vertex) differs from one by more than a half.
//! The candidates laying one vertex are linked into one group, in offer order from the first, and
//! all take the group's largest cost, so `Patches::next_patch` tries a whole group at once.
use super::super::mesh::NONE;
use super::super::vector::{most, space_area, uv_half_area, Vec2, Vec3, AREA_EPSILON};
use super::{flat_corners, orient, same_side, Offer, Patches};
use trillion3d_math::vector::vecn::{add, length, scale, sub};

impl Patches<'_> {
    /// `face` added to the patch, the faces across its edges offered.
    pub(super) fn add_face(&mut self, face: usize) {
        let mesh = self.mesh;
        self.patch.push(face);
        self.in_patch[face] = true;
        self.in_any_patch[face] = true;
        for edge in face * 3..face * 3 + 3 {
            let other = mesh.face_across(edge);
            if other == NONE || self.in_any_patch[other] || self.offered[other] {
                continue;
            }
            let (v0, v1) = mesh.edge_vertices(edge);
            // A face across an edge has a third vertex off it: a face with a repeated vertex
            // never reaches a chart.
            let Some(k) = (0..3).find(|&k| {
                let vertex = mesh.indices[other * 3 + k];
                vertex != v0 && vertex != v1
            }) else {
                continue;
            };
            let free_vertex = mesh.indices[other * 3 + k];
            let patch_orient = orient(
                self.texcoords[v0],
                self.texcoords[v1],
                self.texcoords[mesh.indices[face * 3 + k]],
            );
            if self.vertex_in_patch[free_vertex] || self.refused[other] {
                continue;
            }
            self.offer(edge, patch_orient, other, mesh.opposite(edge), free_vertex);
        }
    }

    /// `face`, across `patch_edge` (its own edge `edge`), laid against the patch and offered.
    fn offer(
        &mut self,
        patch_edge: usize,
        patch_orient: f32,
        face: usize,
        edge: usize,
        free_vertex: usize,
    ) {
        let mesh = self.mesh;
        let mut flat = flat_corners(mesh, face);
        let (v0, v1) = mesh.edge_vertices(patch_edge);
        let (edge_start, edge_stop) = mesh.edge_vertices(edge);
        let local = |wanted: usize| (0..3).find(|&k| mesh.indices[face * 3 + k] == wanted);
        // The face holds its edge's two vertices and a third: a face with a repeated vertex
        // never reaches a chart.
        let (Some(local0), Some(local1)) = (local(edge_stop), local(edge_start)) else {
            return;
        };
        let local_free = 3 - local0 - local1;
        let patch_vector = sub(self.texcoords[v1], self.texcoords[v0]);
        let local_vector = sub(flat[local1], flat[local0]);
        let (len1, len2) = (length(patch_vector), length(local_vector));
        if len1 <= 0.0 || len2 <= 0.0 {
            return;
        }
        let ratio = len1 / len2;
        for p in flat.iter_mut() {
            *p = scale(*p, ratio);
        }
        let shift = sub(self.texcoords[v0], flat[local0]);
        for p in flat.iter_mut() {
            *p = add(*p, shift);
        }
        let angle = patch_vector[1].atan2(patch_vector[0]) - local_vector[1].atan2(local_vector[0]);
        let pivot = flat[local0];
        for (k, p) in flat.iter_mut().enumerate() {
            if k == local0 {
                continue;
            }
            let uv = sub(*p, pivot);
            let (c, s) = (angle.cos(), angle.sin());
            let x = uv[0] * c - uv[1] * s;
            let y = uv[1] * c + uv[0] * s;
            *p = [x + pivot[0], y + pivot[1]];
        }
        let placed = flat[local_free];
        if placed[0].is_nan() || placed[1].is_nan() {
            self.refuse(face);
            return;
        }
        let free_orient = orient(self.texcoords[v0], self.texcoords[v1], placed);
        if same_side(patch_orient, free_orient) {
            self.refuse(face);
            return;
        }
        let balance = area_balance(
            [
                mesh.positions[v0],
                mesh.positions[v1],
                mesh.positions[free_vertex],
            ],
            flat,
        );
        if balance >= f32::MAX {
            self.refuse(face);
            return;
        }
        let cost = (balance - 1.0).abs();
        if cost > 0.5 {
            self.refuse(face);
            return;
        }
        let index = self.arena.len();
        self.arena.push(Offer {
            face,
            vertex: free_vertex,
            next: NONE,
            position: placed,
            cost,
            max_cost: cost,
            patch_edge,
            patch_orient,
        });
        self.candidates.push(index);
        self.offered[face] = true;
        // The live candidates laying one vertex are one group, linked in offer order from the
        // first, and dropped together.
        let head = self.group_of[free_vertex];
        let head = if head == NONE {
            self.group_of[free_vertex] = index;
            index
        } else {
            let mut tail = head;
            while self.arena[tail].next != NONE {
                tail = self.arena[tail].next;
            }
            self.arena[tail].next = index;
            head
        };
        let max_cost = self
            .members(head)
            .fold(0.0f32, |max, c| most(max, self.arena[c].cost));
        let mut candidate = head;
        while candidate != NONE {
            self.arena[candidate].max_cost = max_cost;
            candidate = self.arena[candidate].next;
        }
    }
}

/// The lesser of a face's texture and surface areas over the greater, `f32::MAX` for a texture
/// area of at most `AREA_EPSILON`.
fn area_balance(points: [Vec3; 3], uv: [Vec2; 3]) -> f32 {
    let uv_area = uv_half_area(uv[0], uv[1], uv[2]);
    if uv_area.abs() <= AREA_EPSILON {
        return f32::MAX;
    }
    let uv_area = uv_area.abs();
    let area = space_area(points[0], points[1], points[2]);
    if uv_area <= area {
        uv_area / area
    } else {
        area / uv_area
    }
}
