//! A face's stretch under a plane triangle, and the sums a chart reads from it.
//!
//! - Geometric mean squared: `(|Ss|² + |St|²)/2` times the surface area, `Ss` and `St` the
//!   derivatives of the surface point along the plane's axes; zero for a face of no surface area,
//!   infinite for a folded plane triangle or one under `ZERO2` and half the surface area.
//! - Largest: the larger singular value times the chart's scale, raised to the inverse of the
//!   smaller one when that is larger, infinite when the smaller one vanishes; 1 for a face of no
//!   surface area.
//! - Signal mean squared: the trace of the signal tensor carried to the plane, halved; zero for a
//!   face of no surface area, infinite for a folded or vanishing plane triangle. It also gives the
//!   carried tensor and the map's geometric tensor.
use super::INFINITE_STRETCH;
use crate::hlod::flatten::uv::spectral::mesh::Chart;
use crate::hlod::flatten::uv::spectral::util::{
    affine_tensor, near_zero, near_zero2, plane_gradients, root, signed_area_2d, tensor_on_face,
    ZERO2,
};
use trillion3d_math::vector::vecn::dot;

/// What a face's signal stretch gives besides its value: the carried tensor and the map's
/// geometric tensor.
pub(crate) struct Carried {
    pub tensor: [f32; 3],
    pub geometric: [f32; 3],
}

impl<'a> Chart<'a> {
    /// The plane corners of face `face` with vertex `moved` at `uv` instead (none moved for
    /// `u32::MAX`).
    pub(crate) fn corners_with(&self, face: usize, moved: u32, uv: [f32; 2]) -> [[f32; 2]; 3] {
        self.faces[face].verts.map(|v| {
            if v == moved {
                uv
            } else {
                self.verts[v as usize].uv
            }
        })
    }

    /// The surface corners of face `face`.
    fn surface_corners(&self, face: usize) -> [[f32; 3]; 3] {
        self.faces[face].verts.map(|v| self.point(v))
    }

    /// Face `face`'s stretch of the kind asked under the plane corners `uv`, its signed plane
    /// area, and with a signal the geometric tensor of the map.
    pub(crate) fn face_stretch(
        &self,
        ln: bool,
        signal: bool,
        face: usize,
        uv: [[f32; 2]; 3],
        scale: f32,
    ) -> (f32, f32, Option<[f32; 3]>) {
        if signal {
            let (stretch, area, carried) = self.face_signal_stretch(face, uv);
            (stretch, area, Some(carried.geometric))
        } else if ln {
            let (stretch, area) = self.face_ln_stretch(face, uv, scale);
            (stretch, area, None)
        } else {
            let (stretch, area) = self.face_l2_stretch(face, uv);
            (stretch, area, None)
        }
    }

    /// Face `face`'s signal mean squared stretch under `uv`, its signed plane area, and what the
    /// map carries.
    pub(crate) fn face_signal_stretch(
        &self,
        face: usize,
        uv: [[f32; 2]; 3],
    ) -> (f32, f32, Carried) {
        let root_face = self.faces[face].root;
        let area_3d = self.source.areas[root_face as usize];
        let area_2d = signed_area_2d(uv[0], uv[1], uv[2]);
        let mt = self.tensor(root_face).expect("a signal");
        let fill = |geometric: f32, tensor: f32| Carried {
            tensor: [tensor; 3],
            geometric: [geometric; 3],
        };
        if area_3d == 0.0 {
            return (0.0, area_2d, fill(1.0, 0.0));
        }
        if area_2d < 0.0 {
            return (INFINITE_STRETCH, area_2d, fill(f32::MAX, f32::MAX));
        }
        if area_2d < ZERO2 {
            return if near_zero2(area_3d) {
                (0.0, area_2d, fill(1.0, 0.0))
            } else {
                (INFINITE_STRETCH, area_2d, fill(f32::MAX, f32::MAX))
            };
        }
        let on_face = tensor_on_face(mt, area_3d);
        let canonical = self.source.canonical_uvs[root_face as usize];
        let (tensor, geometric) = affine_tensor(area_2d, uv, canonical, &on_face);
        let geometric = geometric.unwrap_or([0.0; 3]);
        let stretch = (tensor[0] + tensor[2]) / 2.0;
        (stretch, area_2d, Carried { tensor, geometric })
    }

    /// The derivatives of face `face`'s surface point along the plane axes under `uv`.
    fn surface_gradients(
        &self,
        face: usize,
        uv: [[f32; 2]; 3],
        area_2d: f32,
    ) -> ([f32; 3], [f32; 3]) {
        plane_gradients(area_2d, uv, self.surface_corners(face))
    }

    /// What a stretch of face `face` under `uv` is made of: its plane area, its surface gradients
    /// and its surface area; or, `Err`, the stretch a degenerate face has (`flat` when the surface
    /// area is nothing or both areas are next to nothing) with its plane area.
    fn stretch_terms(
        &self,
        face: usize,
        uv: [[f32; 2]; 3],
        flat: f32,
    ) -> Result<(f32, [f32; 3], [f32; 3], f32), (f32, f32)> {
        let area_3d = self.source.areas[self.faces[face].root as usize];
        let area_2d = signed_area_2d(uv[0], uv[1], uv[2]);
        if area_3d == 0.0 {
            return Err((flat, area_2d));
        }
        if area_2d < 0.0 || (area_2d < ZERO2 && area_2d < area_3d / 2.0) {
            return Err((INFINITE_STRETCH, area_2d));
        }
        if near_zero2(area_2d) && near_zero2(area_3d) {
            return Err((flat, area_2d));
        }
        let (ss, st) = self.surface_gradients(face, uv, area_2d);
        Ok((area_2d, ss, st, area_3d))
    }

    /// Face `face`'s geometric mean squared stretch under `uv`, and its signed plane area.
    pub(crate) fn face_l2_stretch(&self, face: usize, uv: [[f32; 2]; 3]) -> (f32, f32) {
        match self.stretch_terms(face, uv, 0.0) {
            Ok((area_2d, ss, st, area_3d)) => {
                ((dot(ss, ss) + dot(st, st)) * area_3d / 2.0, area_2d)
            }
            Err(degenerate) => degenerate,
        }
    }

    /// Face `face`'s largest stretch under `uv` at the chart scale `scale`, and its signed plane
    /// area.
    pub(crate) fn face_ln_stretch(&self, face: usize, uv: [[f32; 2]; 3], scale: f32) -> (f32, f32) {
        let (area_2d, ss, st, _) = match self.stretch_terms(face, uv, 1.0) {
            Ok(terms) => terms,
            Err(degenerate) => return degenerate,
        };
        let (a, c, b) = (dot(ss, ss), dot(st, st), dot(ss, st));
        let disc = (a - c) * (a - c) + 4.0 * b * b;
        let mut stretch = scale * root((a + c + root(disc)) / 2.0);
        let low = (a + c - root(disc)) / 2.0;
        if low >= 0.0 {
            let smallest = scale * root(low);
            if near_zero(smallest) {
                stretch = INFINITE_STRETCH;
            } else if stretch < 1.0 / smallest {
                stretch = 1.0 / smallest;
            }
        } else if stretch < 1.0 {
            stretch = 1.0 / stretch;
        }
        (stretch, area_2d)
    }

    /// The chart's geometric mean squared stretch, the sum over its faces; infinite when one face
    /// is.
    pub(crate) fn geometric_l2_sum(&self) -> f32 {
        let mut total = 0.0;
        for face in 0..self.faces.len() {
            let (stretch, _) =
                self.face_l2_stretch(face, self.corners_with(face, u32::MAX, [0.0; 2]));
            if stretch >= INFINITE_STRETCH {
                return INFINITE_STRETCH;
            }
            total += stretch;
        }
        total
    }

    /// The least mean squared stretch the chart can reach: its surface area.
    pub(crate) fn base_l2_stretch(&self) -> f32 {
        self.area_3d
    }

    /// Vertex `v`'s stretch from its faces' `face_stretch`: their largest for the largest stretch,
    /// else their sum, infinite once the running sum is.
    pub(crate) fn vertex_stretch(&self, ln: bool, v: usize, face_stretch: &[f32]) -> f32 {
        let mut stretch = 0.0;
        for &f in &self.verts[v].faces {
            if ln {
                if stretch < face_stretch[f as usize] {
                    stretch = face_stretch[f as usize];
                }
            } else {
                if stretch == INFINITE_STRETCH {
                    return INFINITE_STRETCH;
                }
                stretch += face_stretch[self.faces[f as usize].id as usize];
            }
        }
        stretch
    }

    /// The root mean square of the edges' plane lengths.
    pub(crate) fn mean_edge_length(&self) -> f32 {
        let mut sum = 0.0;
        for e in &self.edges {
            let (a, b) = (
                self.verts[e.verts[0] as usize].uv,
                self.verts[e.verts[1] as usize].uv,
            );
            let (x, y) = (a[0] - b[0], a[1] - b[1]);
            sum += x * x + y * y;
        }
        root(sum / self.edges.len() as f32)
    }

    /// The scale from the chart's surface to its plane, `√(plane area / surface area)`, with the
    /// two areas; `None` when the surface area is zero.
    pub(crate) fn plane_to_surface_scale(&self) -> Option<(f32, f32, f32)> {
        let area_2d = self.area_2d_sum();
        let area_3d = self.area_3d;
        if near_zero(area_3d) {
            return None;
        }
        Some((root(area_2d / area_3d), area_3d, area_2d))
    }
}
