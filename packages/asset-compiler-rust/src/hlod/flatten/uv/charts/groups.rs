//! The shell as the builder's source mesh, its face groups, and each group's own mesh.
//!
//! - `source_mesh`: the welded shell in single precision, each triangle turned (`TURN`); a face
//!   with a repeated corner, an edge of no length, a NaN corner or an area at most
//!   `AREA_EPSILON` is set aside, tested in that order. Colocals are linked.
//! - `face_groups`: from the first face not yet grouped, the faces reached across edges (found
//!   through colocals, set-aside faces never crossed), depth first, listed in the order reached.
//!   Set-aside faces belong to no group.
//! - `group_mesh`: a group's faces as a mesh of its own, the vertices numbered in order of first
//!   use, with its colocals and boundaries.
use super::mesh::{edge_face, TriMesh, NONE};
use super::vector::{space_area, AREA_EPSILON};
use super::TURN;
use crate::hlod::flatten::uv::Topology;
use trillion3d_math::vector::vecn::{length, sub};
use trillion3d_page_codec::encode::vertices::first_use;

pub(super) fn source_mesh(topology: &Topology) -> TriMesh {
    let mut mesh = TriMesh::default();
    for point in topology.points {
        mesh.add_vertex(point.map(|axis| axis as f32), [0.0; 2]);
    }
    let mut ignored = Vec::with_capacity(topology.triangles.len());
    for triangle in topology.triangles {
        let corners = TURN.map(|k| triangle[k]);
        let positions = corners.map(|vertex| mesh.positions[vertex]);
        let degenerate = (0..3).any(|k| {
            corners[k] == corners[(k + 1) % 3]
                || length(sub(positions[(k + 1) % 3], positions[k])) <= 0.0
        });
        let ignore = degenerate
            || positions.iter().flatten().any(|axis| axis.is_nan())
            || space_area(positions[0], positions[1], positions[2]) <= AREA_EPSILON;
        mesh.add_face(corners);
        ignored.push(ignore);
    }
    mesh.ignored = ignored;
    mesh.link_colocals();
    mesh
}

/// The face groups of `mesh`, each its faces in the order reached.
pub(super) fn face_groups(mesh: &TriMesh) -> Vec<Vec<usize>> {
    let face_count = mesh.face_count();
    let mut grouped = vec![false; face_count];
    let mut groups = Vec::new();
    let mut stack = Vec::new();
    let mut first_free = 0;
    while let Some(seed) = (first_free..face_count).find(|&f| !grouped[f] && !mesh.is_ignored(f)) {
        first_free = seed + 1;
        grouped[seed] = true;
        let mut faces = vec![seed];
        stack.clear();
        stack.push(seed);
        while let Some(face) = stack.pop() {
            for edge in face * 3..face * 3 + 3 {
                let (v0, v1) = mesh.edge_vertices(edge);
                let opposite = mesh.edge_from(v1, v0);
                if opposite == NONE {
                    continue;
                }
                let other = edge_face(opposite);
                if mesh.is_ignored(other) || grouped[other] {
                    continue;
                }
                grouped[other] = true;
                faces.push(other);
                stack.push(other);
            }
        }
        groups.push(faces);
    }
    groups
}

/// The faces `faces` of `source` as a mesh of their own.
pub(super) fn group_mesh(source: &TriMesh, faces: &[usize]) -> TriMesh {
    let corner_vertex = |corner: usize| source.indices[faces[corner / 3] * 3 + corner % 3];
    let (vertices, local) = first_use((0..faces.len() * 3).map(corner_vertex));
    let mut mesh = TriMesh::default();
    for &vertex in &vertices {
        mesh.add_vertex(source.positions[vertex], source.texcoords[vertex]);
    }
    for face in local.as_chunks::<3>().0 {
        mesh.add_face(face.map(|vertex| vertex as usize));
    }
    mesh.link_colocals();
    mesh.match_opposites();
    mesh
}
