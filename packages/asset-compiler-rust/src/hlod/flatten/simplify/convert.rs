//! The extracted surface as the simplifier reads it (`soup`): its points as vertices, each quad
//! split as `(0, 1, 2), (2, 3, 0)` and the triangles after the quads, as they come; each vertex
//! given the unit sum of the normals of the faces around it, each face's normal the unit opposite
//! of its edges' cross product — the surface winds its faces clockwise seen from outside.
use super::nearest::{normalize, SMALL};
use super::reduce::{Soup, Vertex};
use super::volume::surface::Polygonal;
use rayon::prelude::*;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::sub;

/// The unit normal of a clockwise triangle `[a, b, c]`: `-(b - a) × (c - a)`, left as it is when
/// too short to make unit.
pub(super) fn clockwise_normal([a, b, c]: [[f32; 3]; 3]) -> [f32; 3] {
    let mut n = cross(sub(b, a), sub(c, a));
    normalize(&mut n, SMALL);
    n.map(|x| -x)
}

/// The surface `polygonal` as the simplifier's mesh, every vertex normal the unit sum of its
/// faces' normals in face order — zero for a vertex no face uses.
pub(super) fn soup(polygonal: Polygonal) -> Soup {
    let Polygonal {
        points,
        quads,
        triangles,
    } = polygonal;
    let mut indices = Vec::with_capacity(6 * quads.len() + 3 * triangles.len());
    for [a, b, c, d] in quads {
        indices.extend_from_slice(&[a, b, c, c, d, a]);
    }
    for t in triangles {
        indices.extend_from_slice(&t);
    }
    let faces: Vec<[f32; 3]> = (indices.par_chunks(3))
        .map(|t| clockwise_normal([0, 1, 2].map(|k| points[t[k] as usize])))
        .collect();
    let mut sums = vec![[0.0f32; 3]; points.len()];
    for (f, t) in indices.chunks(3).enumerate() {
        for &v in t {
            let sum = &mut sums[v as usize];
            (0..3).for_each(|k| sum[k] += faces[f][k]);
        }
    }
    let vertices = (points.into_iter().zip(sums))
        .map(|(position, mut normal)| {
            normalize(&mut normal, SMALL);
            Vertex { position, normal }
        })
        .collect();
    Soup { vertices, indices }
}
