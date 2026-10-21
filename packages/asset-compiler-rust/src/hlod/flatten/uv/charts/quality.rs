//! How good a chart's texture coordinates are, the tests that keep an orthogonal projection or
//! reject a conformal map:
//!
//! - `boundary_crosses`: whether two boundary edges cross in the plane (`EdgeGrid`);
//! - `flips`: the faces of no texture area (at most `AREA_EPSILON`) and the turned ones; when every
//!   face is turned or flat none counts as turned, and when more than half are turned the others
//!   count instead;
//! - `stretch`: Sander et al.'s texture stretch, the root of the area-weighted mean of each face's
//!   mean squared singular value, and the largest singular value, both scaled by the root of the
//!   texture area over the surface area; flat texture faces are skipped.
use super::grid::{Against, EdgeGrid};
use super::mesh::TriMesh;
use super::vector::{most, space_area, uv_half_area, AREA_EPSILON, MESH_EPSILON};
use trillion3d_math::vector::vecn::{add, dot, scale};

pub(super) fn boundary_crosses(mesh: &TriMesh, grid: &mut EdgeGrid) -> bool {
    grid.reset_to(mesh.border_edges.iter().copied());
    grid.crosses_edges(mesh.uv_corners(), MESH_EPSILON, Against::Itself, &[])
}

/// Half the signed texture area of a face, positive clockwise, rounded as `uv_half_area` rounds
/// it: from the first corner, the `y` differences first.
fn uv_area_from_first(mesh: &TriMesh, face: usize) -> f32 {
    let [a, b, c] = mesh.face_texcoords(face);
    uv_half_area(a, b, c)
}

/// The faces counted turned, and those of no texture area.
pub(super) fn flips(mesh: &TriMesh) -> (u32, u32) {
    let total = mesh.face_count() as u32;
    let (mut turned, mut flat) = (0u32, 0u32);
    for face in 0..mesh.face_count() {
        let area = uv_area_from_first(mesh, face);
        if area.abs() <= AREA_EPSILON {
            flat += 1;
        } else if area < 0.0 {
            turned += 1;
        }
    }
    if turned + flat == total {
        turned = 0;
    }
    if turned > total / 2 {
        turned = total - turned;
    }
    (turned, flat)
}

/// The surface area of the faces with texture area, the stretch and the largest stretch.
pub(super) struct Stretch {
    pub(super) surface_area: f32,
    pub(super) mean: f32,
    pub(super) max: f32,
}

pub(super) fn stretch(mesh: &TriMesh) -> Stretch {
    let (mut surface_area, mut uv_area, mut mean, mut max) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
    for face in 0..mesh.face_count() {
        let [p0, p1, p2] = mesh.face_corners(face);
        let [[t1, s1], [t2, s2], [t3, s3]] = mesh.face_texcoords(face);
        let area = uv_area_from_first(mesh, face);
        if area.abs() <= AREA_EPSILON {
            continue;
        }
        let area = area.abs();
        let geometric = space_area(p0, p1, p2);
        let over = 1.0 / (2.0 * area);
        let ss = scale(
            add(
                add(scale(p0, t2 - t3), scale(p1, t3 - t1)),
                scale(p2, t1 - t2),
            ),
            over,
        );
        let st = scale(
            add(
                add(scale(p0, s3 - s2), scale(p1, s1 - s3)),
                scale(p2, s2 - s1),
            ),
            over,
        );
        let (a, b, c) = (dot(ss, ss), dot(ss, st), dot(st, st));
        let sigma2 = (0.5 * most(0.0, a + c + ((a - c) * (a - c) + 4.0 * (b * b)).sqrt())).sqrt();
        let rms = ((a + c) * 0.5).sqrt();
        mean += rms * rms * geometric;
        max = most(max, sigma2);
        surface_area += geometric;
        uv_area += area;
    }
    if surface_area > 0.0 {
        let norm = (uv_area / surface_area).sqrt();
        mean = (mean / surface_area).sqrt() * norm;
        max *= norm;
    }
    Stretch {
        surface_area,
        mean,
        max,
    }
}
