//! Closed and curved surfaces of the corpus: what a sphere, a lathe and a torus hand the DAG.
use super::*;
use trillion3d_math::vector::vec3::{cross, divide};
use trillion3d_math::vector::vecn::length;

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

/// The surface of revolution of `profile` — `(radius, height)` pairs from bottom to top — about
/// +y, in `segments` columns, each span of the profile cut into `rings` bands, every radius off by
/// up to `wobble` of itself, drawn from `rng`. Written as a modeller's lathe writes it: a seam
/// column repeating the first, and a profile ending at radius 0 closed on an apex written once per
/// column, every second triangle of the last band with two corners on it. Smooth normals, each the
/// sum of its faces' cross products as the vertex is written: every apex and seam copy its own.
pub(super) fn lathe(
    profile: &[[f32; 2]],
    segments: usize,
    rings: usize,
    wobble: f32,
    rng: &mut Xorshift,
) -> (Vec<f32>, Vec<u32>, Vec<f32>) {
    let mut points: Vec<[f32; 2]> = (profile.windows(2))
        .flat_map(|span| {
            (0..rings).map(move |r| {
                let t = r as f32 / rings as f32;
                [0, 1].map(|k| span[0][k] + (span[1][k] - span[0][k]) * t)
            })
        })
        .collect();
    points.extend(profile.last());
    let columns = segments + 1;
    let mut positions = Vec::with_capacity(points.len() * columns * 3);
    for &[radius, height] in &points {
        let first = positions.len();
        for i in 0..segments {
            let angle = i as f32 / segments as f32 * std::f32::consts::TAU;
            let r = radius * (1.0 + (rng.unit() - 0.5) * 2.0 * wobble);
            positions.extend([
                r * portable_sin(angle + std::f32::consts::FRAC_PI_2),
                height,
                -r * portable_sin(angle),
            ]);
        }
        positions.extend_from_within(first..first + 3);
    }
    let indices = grid_indices(segments, points.len() - 1, |i, j| (j * columns + i) as u32);
    let mut normals = vec![0.0f32; positions.len()];
    for tri in indices.as_chunks::<3>().0 {
        let p = tri.map(|v| [0, 1, 2].map(|k| positions[v as usize * 3 + k]));
        let face = cross(
            [0, 1, 2].map(|k| p[1][k] - p[0][k]),
            [0, 1, 2].map(|k| p[2][k] - p[0][k]),
        );
        for &v in tri {
            (0..3).for_each(|k| normals[v as usize * 3 + k] += face[k]);
        }
    }
    for normal in normals.as_chunks_mut::<3>().0 {
        let length = length(*normal);
        if length > 0.0 {
            *normal = divide(*normal, length);
        }
    }
    (positions, indices, normals)
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
