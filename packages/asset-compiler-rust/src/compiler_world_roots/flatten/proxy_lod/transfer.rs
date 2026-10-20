//! The source mesh's attributes carried onto the proxy: barycentres, transfer and projection, normals.
use super::mesh_to_volume::PolyGrid;
use super::parallel::{AosMesh, Bounds};
use super::simplifier::unit_or_kept;
use super::{face_normal, to_proxy_frame};
use rayon::prelude::*;
use trillion3d_math::vec3::{cross, normalize_where, unit_where_squared};
use trillion3d_math::vecn::{dot, squared_length, sub};

/// The sources as one mesh:
/// world positions in centimetres, the triangles of every mesh in order.
pub(super) struct Source {
    pub(super) positions: Vec<[f32; 3]>,
    pub(super) tris: Vec<[u32; 3]>,
    pub(super) bounds: Bounds,
}

impl Source {
    pub(super) fn new(meshes: &[super::super::Mesh]) -> Source {
        let mut positions = Vec::new();
        let mut tris = Vec::new();
        for &(p, indices) in meshes {
            let base = positions.len() as u32;
            positions.extend(p.as_chunks::<3>().0.iter().map(|&v| to_proxy_frame(v)));
            tris.extend(
                indices
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .map(|t| t.map(|i| base + i)),
            );
        }
        // The bounds: the corners of every triangle.
        let (min, max) = trillion3d_math::aabb::aabb_of_f32(
            tris.iter().flatten().map(|&v| positions[v as usize]),
        );
        Source {
            positions,
            tris,
            bounds: Bounds { min, max },
        }
    }

    fn corners(&self, poly: usize) -> [[f32; 3]; 3] {
        self.tris[poly].map(|v| self.positions[v as usize])
    }

    /// Whether the bounds are wider than flat on every axis.
    pub(super) fn has_volume(&self) -> bool {
        (0..3).all(|k| self.bounds.min[k] < self.bounds.max[k])
    }
}

/// The barycentric weights of
/// `point` projected on the triangle's plane.
fn barycentric(v: [[f32; 3]; 3], point: [f32; 3]) -> [f64; 3] {
    let u = sub(v[1], v[0]);
    let w = sub(v[2], v[0]);
    let p = sub(point, v[0]);
    let norm = cross(u, w);
    let nsqr = squared_length(norm);
    let gamma = f64::from(dot(cross(u, p), norm) / nsqr);
    let beta = f64::from(dot(cross(p, w), norm) / nsqr);
    [1.0 - gamma - beta, beta, gamma]
}

/// The corner values weighted in single precision: each term rounded to float, summed in float.
fn interpolate(w: [f64; 3], v: [[f32; 3]; 3]) -> [f32; 3] {
    let term = |i: usize| v[i].map(|c| (f64::from(c) * w[i]) as f32);
    let (a, b, c) = (term(0), term(1), term(2));
    std::array::from_fn(|k| a[k] + b[k] + c[k])
}

fn missed(w: [f64; 3]) -> bool {
    w.iter().any(|&x| x > 1.0 || x < 0.0)
}

/// The closest polygon recorded at the voxel nearest `pos`.
fn closest_poly(field: &PolyGrid, inv_voxel: f64, pos: [f32; 3]) -> Option<usize> {
    let ijk = pos.map(|c| (f64::from(c) * inv_voxel + 0.5).floor() as i32);
    field.probe(ijk).map(|p| p as usize)
}

/// The source normals blended in, then the vertices pulled onto the source, in that order: a
/// vertex whose projection lands inside its closest polygon adds three times that polygon's normal
/// when they agree (dot over 0.2), then moves three quarters of the way onto the projection when
/// within three voxels. The source normals are each source triangle's face normal: the meshes
/// reach the builder without normals. One lookup a vertex: the normal moves, never the position
/// the polygon is found from, before the position does.
pub(super) fn transfer_and_project(
    source: &Source,
    field: &PolyGrid,
    voxel: f64,
    mesh: &mut AosMesh,
) {
    let inv = 1.0 / voxel;
    let max_close_dist_sqr = (9.0 * voxel * voxel) as f32;
    mesh.verts.par_iter_mut().for_each(|vert| {
        let Some(poly) = closest_poly(field, inv, vert.pos) else {
            return;
        };
        let corners = source.corners(poly);
        let weights = barycentric(corners, vert.pos);
        if missed(weights) {
            return;
        }
        let normal = face_normal(corners);
        let transferred =
            unit_where_squared(interpolate(weights, [normal; 3]), |square| square > 0.1);
        if let Some(transferred) = transferred.filter(|&t| dot(t, vert.normal) > 0.2) {
            vert.normal = unit_or_kept(std::array::from_fn(|k| {
                vert.normal[k] + 3.0 * transferred[k]
            }));
        }
        let projected = interpolate(weights, corners).map(f64::from);
        let current = vert.pos.map(f64::from);
        if squared_length(sub(projected, current)) < f64::from(max_close_dist_sqr) {
            let q = f64::from(0.25f32);
            let r = f64::from(0.75f32);
            vert.pos = std::array::from_fn(|k| (q * current[k] + r * projected[k]) as f32);
        }
    });
}

/// Each vertex's normal: the normalized sum of its triangles' face normals.
pub(super) fn face_averaged_normals(mesh: &mut AosMesh) {
    let mut sums = vec![[0.0f32; 3]; mesh.verts.len()];
    for t in mesh.indexes.chunks_exact(3) {
        let n = face_normal([t[0], t[1], t[2]].map(|v| mesh.verts[v as usize].pos));
        for &v in t {
            let s = &mut sums[v as usize];
            *s = std::array::from_fn(|k| s[k] + n[k]);
        }
    }
    for (vert, n) in mesh.verts.iter_mut().zip(sums) {
        vert.normal = unit_or_kept(n);
    }
}

/// Angle weighted vertex normals for clockwise winding: each vertex's normal the
/// sum of its triangles' face normals weighted by the corner's angle, negated for the clockwise
/// winding.
pub(super) fn angle_weighted_normals(positions: &[[f32; 3]], indices: &[u32]) -> Vec<[f32; 3]> {
    fn normalize(v: [f32; 3]) -> [f32; 3] {
        normalize_where(v, |l| l > 0.0).unwrap_or([0.0; 3])
    }
    fn angle(a: [f32; 3], b: [f32; 3]) -> f32 {
        dot(normalize(a), normalize(b)).clamp(-1.0, 1.0).acos()
    }
    let mut sums = vec![[0.0f32; 3]; positions.len()];
    for t in indices.chunks_exact(3) {
        let [p0, p1, p2] = [t[0], t[1], t[2]].map(|v| positions[v as usize]);
        let (u, v) = (sub(p1, p0), sub(p2, p0));
        let face = normalize(cross(u, v));
        let w = [
            angle(u, v),
            angle(sub(p2, p1), sub(p0, p1)),
            angle(sub(p0, p2), sub(p1, p2)),
        ];
        for (corner, &vert) in t.iter().enumerate() {
            let s = &mut sums[vert as usize];
            *s = std::array::from_fn(|k| face[k] * w[corner] + s[k]);
        }
    }
    sums.into_iter().map(|s| normalize(s).map(|c| -c)).collect()
}
