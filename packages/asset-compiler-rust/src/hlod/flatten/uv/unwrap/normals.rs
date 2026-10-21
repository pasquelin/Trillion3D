//! The vertex normals an exponential map frames its vertices with, an island candidate's measure
//! and an island's map alike: each vertex's triangles' normals weighed by their area and by the
//! vertex's interior angle on each (`weighted`), then smoothed over its neighbours (`smoothed`).
use super::submesh::Submesh;
use super::{NORMAL_SMOOTHING_ALPHA, NORMAL_SMOOTHING_ROUNDS};
use trillion3d_math::geometry::triangle::{corner_angle, triangle_cross};
use trillion3d_math::vector::vec3::unit_or_itself;
use trillion3d_math::vector::vecn::lerp;

/// Per vertex of `mesh`, its normal: the sum over its triangles of each one's normal its area long
/// — as a `z`-up mesh winds it, `(c − a) × (b − a)` — times the vertex's interior angle on it
/// (`corner_angle`), made unit; zero where that sum is (`unit_or_itself`), so a vertex of
/// degenerate triangles only weighs nothing in its neighbours' smoothing.
pub(super) fn weighted(mesh: &Submesh) -> Vec<[f64; 3]> {
    let mut sums = vec![[0.0f64; 3]; mesh.vertices.len()];
    for &tri in &mesh.triangles {
        let corners = tri.map(|v| mesh.point(v));
        // Twice the area long; the halves cancel once made unit.
        let face = triangle_cross(corners[0], corners[2], corners[1]);
        for (k, &v) in tri.iter().enumerate() {
            let angle = corner_angle(corners, k);
            for axis in 0..3 {
                sums[v][axis] += face[axis] * angle;
            }
        }
    }
    sums.into_iter().map(unit_or_itself).collect()
}

/// `normals` smoothed `NORMAL_SMOOTHING_ROUNDS` times over `mesh`'s neighbours: every round, each
/// normal moved `NORMAL_SMOOTHING_ALPHA` of the way towards the unit sum of its neighbours' of the
/// round before, then made unit again — a crease's turn spread over the vertices around it, so the
/// map's frames turn smoothly across it.
pub(super) fn smoothed(mut normals: Vec<[f64; 3]>, mesh: &Submesh) -> Vec<[f64; 3]> {
    for _ in 0..NORMAL_SMOOTHING_ROUNDS {
        normals = (0..normals.len())
            .map(|v| {
                let mut sum = [0.0f64; 3];
                for n in mesh.neighbours(v) {
                    for axis in 0..3 {
                        sum[axis] += normals[n][axis];
                    }
                }
                unit_or_itself(lerp(
                    normals[v],
                    unit_or_itself(sum),
                    NORMAL_SMOOTHING_ALPHA,
                ))
            })
            .collect();
    }
    normals
}
