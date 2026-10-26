//! The source triangle nearest a point (`Nearest`): the one the field's closest-polygon tree holds
//! at the voxel the point rounds to, where that voxel is active. Through it the surface's vertices
//! take their sources' normals (`take_normals`) and are drawn three quarters of the way onto their
//! sources (`project`), so a single-sided source does not come out thicker than it is.
use super::reduce::Soup;
use super::sources::Sources;
use super::volume::tree::Tree;
use rayon::prelude::*;
use trillion3d_math::vector::vec3::{cross, unit_where_squared};
use trillion3d_math::vector::vecn::{dot, sub};

/// The closest-polygon tree of a field on a voxel of `voxel` centimetres, over `sources`.
pub(super) struct Nearest<'a> {
    pub closest: &'a Tree<i32>,
    pub sources: &'a Sources,
    pub voxel: f64,
}

/// The barycentric weights of `p` projected on the plane of the triangle `corners`, single
/// precision as the method computes them, each weight then widened: `1 - γ - β`, `β`, `γ`.
pub(super) fn weights(corners: [[f32; 3]; 3], p: [f32; 3]) -> [f64; 3] {
    let u = sub(corners[1], corners[0]);
    let v = sub(corners[2], corners[0]);
    let w = sub(p, corners[0]);
    let n = cross(u, v);
    let squared = dot(n, n);
    let gamma = f64::from(dot(cross(u, w), n) / squared);
    let beta = f64::from(dot(cross(w, v), n) / squared);
    [1.0 - gamma - beta, beta, gamma]
}

/// Whether weights `w` place their point outside the triangle: one above 1 or below 0 — a NaN
/// weight is neither.
pub(super) fn missed(w: [f64; 3]) -> bool {
    w.iter().any(|&x| x > 1.0 || x < 0.0)
}

/// `values`, each of `N` channels, blended by weights `w`, each weight narrowed to single
/// precision as the method blends.
pub(super) fn blend<const N: usize>(w: [f64; 3], values: [[f32; N]; 3]) -> [f32; N] {
    let w = w.map(|x| x as f32);
    std::array::from_fn(|k| w[0] * values[0][k] + w[1] * values[1][k] + w[2] * values[2][k])
}

/// `v` scaled to unit length when its squared length passes `tolerance`; `false`, left as it is,
/// otherwise (`unit_where_squared`).
pub(super) fn normalize(v: &mut [f32; 3], tolerance: f32) -> bool {
    match unit_where_squared(*v, |squared| squared > tolerance) {
        Some(unit) => {
            *v = unit;
            true
        }
        None => false,
    }
}

/// The tolerance a unit vector is made unit under by default.
pub(super) const SMALL: f32 = 1e-8;

impl Nearest<'_> {
    /// The source triangle the voxel `p` rounds to holds, and whether that voxel is active —
    /// the first triangle when it is not.
    pub(super) fn at(&self, p: [f32; 3]) -> (usize, bool) {
        let inverse = 1.0 / self.voxel;
        let c = p.map(|x| (f64::from(x) * inverse + 0.5).floor() as i32);
        match self.closest.probe(c) {
            (index, true) => (index as usize, true),
            _ => (0, false),
        }
    }

    /// The source triangle nearest `p` and `p`'s weights on it, when `p` projects inside it.
    fn inside(&self, p: [f32; 3]) -> Option<(usize, [f64; 3])> {
        let (t, found) = self.at(p);
        if !found {
            return None;
        }
        let w = weights(self.sources.corners(t), p);
        (!missed(w)).then_some((t, w))
    }
}

/// Each vertex of `mesh` turned towards its nearest source's normal: where it projects inside that
/// triangle, the triangle's corner normals blended at it, made unit when longer than a tolerance of
/// 0.1, and, when it leans within about 78° of the vertex's own (a cosine above 0.2), added three
/// times over to it, the sum made unit.
pub(super) fn take_normals(nearest: &Nearest, mesh: &mut Soup) {
    mesh.vertices.par_iter_mut().for_each(|vertex| {
        let Some((t, w)) = nearest.inside(vertex.position) else {
            return;
        };
        let mut taken = blend(w, nearest.sources.corner_normals(t));
        let unit = normalize(&mut taken, 0.1);
        let n = vertex.normal;
        if unit && n[0] * taken[0] + n[1] * taken[1] + n[2] * taken[2] > 0.2 {
            let mut sum = [0, 1, 2].map(|k| n[k] + 3.0 * taken[k]);
            normalize(&mut sum, SMALL);
            vertex.normal = sum;
        }
    });
}

/// Each vertex of `mesh` drawn onto its nearest source: where it projects inside that triangle
/// within three voxels of its projection, three quarters of the way to it.
pub(super) fn project(nearest: &Nearest, mesh: &mut Soup) {
    let reach = (9.0 * nearest.voxel * nearest.voxel) as f32;
    mesh.vertices.par_iter_mut().for_each(|vertex| {
        let p = vertex.position;
        let Some((t, w)) = nearest.inside(p) else {
            return;
        };
        let on = blend(w, nearest.sources.corners(t)).map(f64::from);
        let current = p.map(f64::from);
        let squared: f64 = (0..3).map(|k| (on[k] - current[k]).powi(2)).sum();
        if squared < f64::from(reach) {
            vertex.position = [0, 1, 2].map(|k| (0.25 * current[k] + 0.75 * on[k]) as f32);
        }
    });
}
