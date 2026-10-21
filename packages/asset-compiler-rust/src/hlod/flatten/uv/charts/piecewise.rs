//! A chart whose conformal map failed, cut into patches each laid flat face by face:
//!
//! 1. a patch starts on the first face in no patch, projected on its own plane (its normal turned
//!    over, its first edge as tangent);
//! 2. each face across the patch's front whose third vertex is not yet in the patch is a
//!    candidate: projected on its own plane, scaled, moved and turned so its shared edge lies on
//!    the patch's; refused (never offered to this patch again) when its third vertex lands on the
//!    patch's side of the edge (by the orientation of the patch face's corner at the same place,
//!    where the generator reads it), or when its stretch (the lesser of texture and surface area
//!    over the greater, against the patch edge's vertices and the third vertex) differs from one by
//!    more than a half. Candidates sharing a third vertex are linked, and share their largest
//!    cost (`offer`);
//! 3. the candidate group of least cost (the first on a tie) is tried: its third vertex placed at
//!    the mean of its positions, the group refused if a face then turns, has no area, or a new
//!    boundary edge crosses the patch's boundary (the edges that would close ignored), else added;
//!    until no candidate is left.
use super::grid::{Against, Corners, EdgeGrid};
use super::mesh::{TriMesh, NONE};
use super::vector::{negate, signed_half_area, unit, Frame, Vec2, MESH_EPSILON};
use trillion3d_math::vector::vecn::{add, scale, sub};

mod offer;

struct Offer {
    face: usize,
    vertex: usize,
    /// The next candidate of its group, `NONE` for the last.
    next: usize,
    position: Vec2,
    cost: f32,
    max_cost: f32,
    patch_edge: usize,
    patch_orient: f32,
}

pub(super) struct Patches<'a> {
    mesh: &'a TriMesh,
    /// Per vertex of the chart's mesh, its texture coordinates in the patch that placed it.
    pub(super) texcoords: Vec<Vec2>,
    in_any_patch: Vec<bool>,
    /// The least face that may be in no patch yet: a face joins one for good.
    next_seed: usize,
    arena: Vec<Offer>,
    /// The live candidates, in the order they were offered.
    candidates: Vec<usize>,
    /// Per face, whether it is a live candidate.
    offered: Vec<bool>,
    /// Per vertex, the head of the live group laying it (its first candidate), or `NONE`.
    group_of: Vec<usize>,
    /// The current patch's faces.
    pub(super) patch: Vec<usize>,
    in_patch: Vec<bool>,
    vertex_in_patch: Vec<bool>,
    refused: Vec<bool>,
    /// The faces `refused` marks, cleared with the patch.
    refused_faces: Vec<usize>,
    /// The patch's boundary: its faces' edges with no patch face across, in patch order.
    boundary: Vec<usize>,
    grid: EdgeGrid,
    /// The group being tried.
    group: Vec<usize>,
    new_edges: Vec<usize>,
    closing_edges: Vec<usize>,
}

/// Which side of the edge `e0 e1` the point `p` is on, by sign.
fn orient(e0: Vec2, e1: Vec2, p: Vec2) -> f32 {
    (e0[0] - p[0]) * (e1[1] - p[1]) - (e0[1] - p[1]) * (e1[0] - p[0])
}

/// Whether two orientations are strictly on the same side.
fn same_side(a: f32, b: f32) -> bool {
    (a < 0.0 && b < 0.0) || (a > 0.0 && b > 0.0)
}

impl<'a> Patches<'a> {
    pub(super) fn new(mesh: &'a TriMesh) -> Patches<'a> {
        let (faces, vertices) = (mesh.face_count(), mesh.positions.len());
        Patches {
            mesh,
            texcoords: vec![[0.0; 2]; vertices],
            in_any_patch: vec![false; faces],
            next_seed: 0,
            arena: Vec::new(),
            candidates: Vec::new(),
            offered: vec![false; faces],
            group_of: vec![NONE; vertices],
            patch: Vec::new(),
            in_patch: vec![false; faces],
            vertex_in_patch: vec![false; vertices],
            refused: vec![false; faces],
            refused_faces: Vec::new(),
            boundary: Vec::new(),
            grid: EdgeGrid::default(),
            group: Vec::new(),
            new_edges: Vec::new(),
            closing_edges: Vec::new(),
        }
    }

    /// The next patch grown in `patch`; `false` when every face is in one.
    pub(super) fn next_patch(&mut self) -> bool {
        let mesh = self.mesh;
        // The last patch's marks cleared: its faces and their vertices, its offers, its refusals.
        for &face in &self.patch {
            self.in_patch[face] = false;
            for &vertex in &mesh.indices[face * 3..face * 3 + 3] {
                self.vertex_in_patch[vertex] = false;
            }
        }
        for offer in &self.arena {
            self.offered[offer.face] = false;
            self.group_of[offer.vertex] = NONE;
        }
        for &face in &self.refused_faces {
            self.refused[face] = false;
        }
        self.patch.clear();
        self.candidates.clear();
        self.arena.clear();
        self.refused_faces.clear();
        let free = (self.next_seed..mesh.face_count()).find(|&face| !self.in_any_patch[face]);
        let Some(seed) = free else {
            return false;
        };
        self.next_seed = seed + 1;
        let projected = flat_corners(mesh, seed);
        for (&vertex, uv) in mesh.indices[seed * 3..seed * 3 + 3].iter().zip(projected) {
            self.vertex_in_patch[vertex] = true;
            self.texcoords[vertex] = uv;
        }
        self.add_face(seed);
        self.boundary.clear();
        self.boundary.extend(seed * 3..seed * 3 + 3);
        self.grid.reset_to(self.boundary.iter().copied());
        let mut group = std::mem::take(&mut self.group);
        loop {
            let mut lowest = f32::MAX;
            let mut best = NONE;
            for &candidate in &self.candidates {
                if self.arena[candidate].max_cost < lowest {
                    lowest = self.arena[candidate].max_cost;
                    best = candidate;
                }
            }
            if best == NONE {
                break;
            }
            // The least cost is a group's, all its candidates sharing it: the first is its head.
            group.clear();
            group.extend(self.members(best));
            let mut position = [0.0f32; 2];
            for &candidate in &group {
                position = add(position, self.arena[candidate].position);
            }
            position = scale(position, 1.0 / group.len() as f32);
            let free_vertex = self.arena[best].vertex;
            self.texcoords[free_vertex] = position;
            let mut invalid = group.iter().any(|&candidate| {
                let (v0, v1) = mesh.edge_vertices(self.arena[candidate].patch_edge);
                let side = orient(self.texcoords[v0], self.texcoords[v1], position);
                same_side(self.arena[candidate].patch_orient, side)
            });
            invalid = invalid
                || group.iter().any(|&candidate| {
                    let face = self.arena[candidate].face;
                    let [a, b, c] = [0, 1, 2].map(|k| self.texcoords[mesh.indices[face * 3 + k]]);
                    signed_half_area(a, b, c) <= 0.0
                });
            if !invalid {
                self.new_edges.clear();
                self.closing_edges.clear();
                for &candidate in &group {
                    let face = self.arena[candidate].face;
                    for edge in face * 3..face * 3 + 3 {
                        let other = mesh.face_across(edge);
                        if other == NONE || !self.in_patch[other] {
                            self.new_edges.push(edge);
                        } else {
                            self.closing_edges.push(mesh.opposite(edge));
                        }
                    }
                }
                let corners = Corners::Indexed {
                    positions: &self.texcoords,
                    indices: &mesh.indices,
                };
                // A group closing on the patch along all its edges tests the boundary against
                // itself, as the generator reads an empty list.
                let against = if self.new_edges.is_empty() {
                    Against::Itself
                } else {
                    Against::Edges(&self.new_edges)
                };
                invalid =
                    self.grid
                        .crosses_edges(corners, MESH_EPSILON, against, &self.closing_edges);
            }
            if invalid {
                for &candidate in &group {
                    self.refuse(self.arena[candidate].face);
                }
                self.drop_group(&group);
                continue;
            }
            self.vertex_in_patch[free_vertex] = true;
            for &candidate in &group {
                self.add_face(self.arena[candidate].face);
            }
            self.drop_group(&group);
            // The boundary in patch order: the edges the group closed dropped, its own open ones
            // after, as a scan of the patch's faces lists them.
            let (in_patch, boundary) = (&self.in_patch, &mut self.boundary);
            let open = |edge: usize| {
                let other = mesh.face_across(edge);
                other == NONE || !in_patch[other]
            };
            boundary.retain(|&edge| open(edge));
            for &candidate in &group {
                let face = self.arena[candidate].face;
                boundary.extend((face * 3..face * 3 + 3).filter(|&edge| open(edge)));
            }
            self.grid.reset_to(self.boundary.iter().copied());
        }
        self.group = group;
        true
    }

    /// The candidates linked from `head`, in link order.
    fn members(&self, head: usize) -> impl Iterator<Item = usize> + '_ {
        std::iter::successors(Some(head), |&candidate| {
            Some(self.arena[candidate].next).filter(|&next| next != NONE)
        })
    }

    /// The group's candidates withdrawn.
    fn drop_group(&mut self, group: &[usize]) {
        for &candidate in group {
            let offer = &self.arena[candidate];
            self.offered[offer.face] = false;
            self.group_of[offer.vertex] = NONE;
            if let Some(at) = self.candidates.iter().position(|&live| live == candidate) {
                self.candidates.remove(at);
            }
        }
    }

    /// `face` refused for the current patch.
    fn refuse(&mut self, face: usize) {
        self.refused[face] = true;
        self.refused_faces.push(face);
    }
}

/// A face's corners projected on its own plane: its normal turned over, its first edge as the
/// tangent.
fn flat_corners(mesh: &TriMesh, face: usize) -> [Vec2; 3] {
    let [p0, p1, p2] = mesh.face_corners(face);
    let frame = Frame::new(negate(mesh.face_normal(face)), unit(sub(p1, p0)));
    [p0, p1, p2].map(|p| frame.project(p))
}
