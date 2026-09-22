//! Closed and curved surfaces of the corpus: what a sphere and a torus hand the DAG.
use super::shapes::grid_indices;
use super::*;

/// A latitude–longitude sphere of radius `radius`: `segments + 1` columns so the seam column
/// carries both `u = 0` and `u = 1`, one triangle per segment at each pole.
pub(super) fn sphere(radius: f32, segments: usize, rings: usize) -> (Vec<f32>, Vec<u32>, Vec<f32>) {
    let (mut positions, mut uvs, mut indices) = (Vec::new(), Vec::new(), Vec::new());
    let columns = segments + 1;
    for ring in 0..=rings {
        let theta = ring as f32 / rings as f32 * std::f32::consts::PI;
        for segment in 0..=segments {
            let phi = segment as f32 / segments as f32 * std::f32::consts::TAU;
            let (sin_theta, cos_theta) = (
                portable_sin(theta),
                portable_sin(theta + std::f32::consts::FRAC_PI_2),
            );
            let (sin_phi, cos_phi) = (
                portable_sin(phi),
                portable_sin(phi + std::f32::consts::FRAC_PI_2),
            );
            positions.extend([
                radius * sin_theta * cos_phi,
                radius * cos_theta,
                radius * sin_theta * sin_phi,
            ]);
            uvs.extend([segment as f32 / segments as f32, ring as f32 / rings as f32]);
        }
    }
    let vertex = |ring: usize, segment: usize| (ring * columns + segment) as u32;
    for ring in 0..rings {
        for segment in 0..segments {
            let (a, b, c, d) = (
                vertex(ring, segment),
                vertex(ring, segment + 1),
                vertex(ring + 1, segment),
                vertex(ring + 1, segment + 1),
            );
            if ring > 0 {
                indices.extend([a, b, c]);
            }
            if ring + 1 < rings {
                indices.extend([b, d, c]);
            }
        }
    }
    (positions, indices, uvs)
}

/// A closed torus, no seam anywhere: every vertex is shared all the way round.
pub(super) fn torus(
    major_radius: f32,
    minor_radius: f32,
    major: usize,
    minor: usize,
) -> (Vec<f32>, Vec<u32>) {
    let mut positions = Vec::with_capacity(major * minor * 3);
    for i in 0..major {
        let a = i as f32 / major as f32 * std::f32::consts::TAU;
        for j in 0..minor {
            let b = j as f32 / minor as f32 * std::f32::consts::TAU;
            let ring = major_radius + minor_radius * portable_sin(b + std::f32::consts::FRAC_PI_2);
            positions.extend([
                ring * portable_sin(a + std::f32::consts::FRAC_PI_2),
                minor_radius * portable_sin(b),
                ring * portable_sin(a),
            ]);
        }
    }
    let indices = grid_indices(major, minor, |i, j| {
        ((i % major) * minor + j % minor) as u32
    });
    (positions, indices)
}
