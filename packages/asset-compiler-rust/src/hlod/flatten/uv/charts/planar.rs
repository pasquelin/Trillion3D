//! A face group's surface measures and its planar regions.
//!
//! `Surface` holds per edge its length and the dot product of its two faces' normals (read only
//! off the boundary), per face its area and unit normal.
//!
//! `PlanarRegions` gathers, from each face not yet in a region, the faces reached across edges
//! whose normals agree within `EPSILON` (depth first, each new face linked in the region's ring
//! right after the face it was reached from), and sums each region's area. A region becomes a
//! chart when every edge it shares with another region turns by at least a right angle (a dot
//! product of the normals at most zero); its faces are then in a chart, listed in ring order from
//! the region's first face, its frame `Frame::around` that face's normal.
use super::mesh::{TriMesh, NONE};
use super::vector::{near, Frame, Vec3, EPSILON};
use trillion3d_math::vector::vecn::{dot, length, sub};

pub(super) struct Surface {
    pub(super) mesh: TriMesh,
    pub(super) edge_lengths: Vec<f32>,
    pub(super) face_areas: Vec<f32>,
    pub(super) face_normals: Vec<Vec3>,
    pub(super) dihedral: Vec<f32>,
}

impl Surface {
    pub(super) fn new(mesh: TriMesh) -> Surface {
        let face_count = mesh.face_count();
        let mut edge_lengths = vec![0.0; face_count * 3];
        for (edge, length_of) in edge_lengths.iter_mut().enumerate() {
            let (v0, v1) = mesh.edge_vertices(edge);
            *length_of = length(sub(mesh.positions[v1], mesh.positions[v0]));
        }
        let face_areas = (0..face_count).map(|face| mesh.face_area(face)).collect();
        let face_normals: Vec<Vec3> = (0..face_count).map(|face| mesh.face_normal(face)).collect();
        let mut dihedral = vec![0.0; face_count * 3];
        for edge in 0..face_count * 3 {
            let opposite = mesh.opposite(edge);
            if opposite != NONE {
                let turn = dot(face_normals[edge / 3], face_normals[opposite / 3]);
                dihedral[edge] = turn;
                dihedral[opposite] = turn;
            }
        }
        Surface {
            mesh,
            edge_lengths,
            face_areas,
            face_normals,
            dihedral,
        }
    }
}

pub(super) struct PlanarRegions {
    /// Per face, the next face of its region's ring.
    pub(super) next: Vec<usize>,
    /// Per face, its region.
    pub(super) region: Vec<usize>,
    pub(super) areas: Vec<f32>,
    /// The regions made charts: their faces, and their frames.
    pub(super) charts: Vec<(Vec<usize>, Frame)>,
}

impl PlanarRegions {
    /// The regions of `surface`, the faces of the regions made charts marked in `in_chart`.
    pub(super) fn new(surface: &Surface, in_chart: &mut [bool]) -> PlanarRegions {
        let mesh = &surface.mesh;
        let face_count = mesh.face_count();
        let mut next: Vec<usize> = (0..face_count).collect();
        let mut region = vec![NONE; face_count];
        let mut first_faces = Vec::new();
        let mut stack = Vec::new();
        for first in 0..face_count {
            if next[first] != first || in_chart[first] {
                continue;
            }
            let id = first_faces.len();
            stack.clear();
            stack.push(first);
            while let Some(face) = stack.pop() {
                region[face] = id;
                for edge in face * 3..face * 3 + 3 {
                    let other = mesh.face_across(edge);
                    if other == NONE || next[other] != other || in_chart[other] {
                        continue;
                    }
                    let turn = dot(surface.face_normals[face], surface.face_normals[other]);
                    if !near(turn, 1.0, EPSILON) {
                        continue;
                    }
                    next[other] = next[face];
                    next[face] = other;
                    region[other] = id;
                    stack.push(other);
                }
            }
            first_faces.push(first);
        }
        let mut areas = vec![0.0f32; first_faces.len()];
        for face in 0..face_count {
            if region[face] != NONE {
                areas[region[face]] += surface.face_areas[face];
            }
        }
        let mut charts = Vec::new();
        for (id, &first) in first_faces.iter().enumerate() {
            let mut faces = vec![first];
            let mut face = next[first];
            while face != first {
                faces.push(face);
                face = next[face];
            }
            let open = faces.iter().any(|&face| {
                (face * 3..face * 3 + 3).any(|edge| {
                    let other = mesh.face_across(edge);
                    other != NONE && region[other] != id && surface.dihedral[edge] > 0.0
                })
            });
            if !open {
                for &face in &faces {
                    in_chart[face] = true;
                }
                charts.push((faces, Frame::around(surface.face_normals[first])));
            }
        }
        PlanarRegions {
            next,
            region,
            areas,
            charts,
        }
    }

    /// The faces of `face`'s region, in ring order from `face`.
    pub(super) fn ring(&self, face: usize) -> impl Iterator<Item = usize> + '_ {
        let mut current = face;
        let mut done = false;
        std::iter::from_fn(move || {
            if done {
                return None;
            }
            let here = current;
            current = self.next[current];
            done = current == face;
            Some(here)
        })
    }
}
