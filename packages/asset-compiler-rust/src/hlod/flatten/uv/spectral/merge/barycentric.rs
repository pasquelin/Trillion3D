//! A chart of one boundary laid flat by barycentric coordinates.
//!
//! The boundary, walked from its first vertex in vertex order toward the first of its ring
//! neighbours, is laid on the unit circle at angles proportional to the surface length walked (in
//! double precision); a boundary vertex the walk misses stays at angle zero. Each inner vertex
//! sits at the mean of its neighbours: the system `A` (its degree on the diagonal, −1 for each
//! inner neighbour, the boundary neighbours' positions on the right) is solved in its normal form
//! `AᵀA x = Aᵀb` by conjugate gradients (`solve`: at most 10 000 iterations, tolerance 10⁻⁸), one
//! axis after the other. The layout holds when no face is folded; the chart is then scaled to its
//! surface area.
use super::solve::Sparse;
use crate::hlod::flatten::uv::spectral::mesh::Chart;
use crate::hlod::flatten::uv::spectral::util::{root, root64, signed_area_2d};
use std::f64::consts::PI;

/// The most iterations of a solve; a solve that needs them all fails.
const MAX_ITERATIONS: usize = 10000;
/// The solves' relative tolerance.
const TOLERANCE: f64 = 1e-8;
/// The most boundary vertices a layout takes.
const MAX_BOUNDARY: usize = 0x8000_0000;

impl<'a> Chart<'a> {
    /// The chart laid flat by barycentric coordinates when the layout holds; whether it overlaps
    /// (or could not be made).
    pub(crate) fn barycentric(&mut self) -> bool {
        let mut map = vec![0usize; self.verts.len()];
        let (mut boundary, mut inner) = (0, 0);
        for (slot, v) in map.iter_mut().zip(&self.verts) {
            let counter = if v.boundary {
                &mut boundary
            } else {
                &mut inner
            };
            *slot = *counter;
            *counter += 1;
        }
        if boundary == 0 || boundary >= MAX_BOUNDARY {
            return true;
        }
        let Some(circle) = self.boundary_circle(boundary, &map) else {
            return true;
        };
        let (system, bu, bv) = self.barycentric_system(inner, &circle, &map);
        let normal = system.normal();
        let (u, iterations) =
            normal.conjugate_gradient(&system.transposed_product(&bu), MAX_ITERATIONS, TOLERANCE);
        if iterations >= MAX_ITERATIONS {
            return true;
        }
        let (v, iterations) =
            normal.conjugate_gradient(&system.transposed_product(&bv), MAX_ITERATIONS, TOLERANCE);
        if iterations >= MAX_ITERATIONS {
            return true;
        }
        for (vert, &slot) in self.verts.iter_mut().zip(&map) {
            vert.uv = if vert.boundary {
                [circle[2 * slot] as f32, circle[2 * slot + 1] as f32]
            } else {
                [u[slot] as f32, v[slot] as f32]
            };
        }
        self.fit_barycentric_layout()
    }

    /// Each boundary vertex's place on the unit circle, two per boundary slot; `None` without a
    /// boundary vertex. The walk stops after as many steps as vertices.
    fn boundary_circle(&self, count: usize, map: &[usize]) -> Option<Vec<f64>> {
        let first = self.verts.iter().position(|v| v.boundary)?;
        let mut circle = vec![0f64; 2 * count];
        let length = |a: usize, b: usize| {
            let (p, q) = (self.point(a as u32), self.point(b as u32));
            let (dx, dy, dz) = (p[0] - q[0], p[1] - q[1], p[2] - q[2]);
            root(dx * dx + dy * dy + dz * dz)
        };
        let (mut previous, mut current) = (first, first);
        let mut total = 0f64;
        for _ in 0..self.verts.len() {
            let ring = &self.verts[current].verts;
            let (a, b) = (ring[0] as usize, ring[ring.len() - 1] as usize);
            let next = if a != previous { a } else { b };
            previous = current;
            current = next;
            total += length(current, previous) as f64;
            if next == first {
                break;
            }
            circle[2 * map[next]] = total;
        }
        for pair in circle.chunks_exact_mut(2) {
            let angle = 2.0 * pair[0] * PI / total;
            pair[0] = angle.cos();
            pair[1] = angle.sin();
        }
        Some(circle)
    }

    /// The inner vertices' system and its two right-hand sides.
    fn barycentric_system(
        &self,
        inner: usize,
        circle: &[f64],
        map: &[usize],
    ) -> (Sparse, Vec<f64>, Vec<f64>) {
        let mut system = Sparse::new(inner, inner);
        let (mut bu, mut bv) = (vec![0f64; inner], vec![0f64; inner]);
        for (i, v) in self.verts.iter().enumerate() {
            if v.boundary {
                continue;
            }
            let row = map[i];
            let (mut sum_u, mut sum_v) = (0f64, 0f64);
            system.set(row, row, v.verts.len() as f64);
            for &n in &v.verts {
                if self.verts[n as usize].boundary {
                    sum_u += circle[2 * map[n as usize]];
                    sum_v += circle[2 * map[n as usize] + 1];
                } else {
                    system.set(row, map[n as usize], -1.0);
                }
            }
            bu[row] = sum_u;
            bv[row] = sum_v;
        }
        (system, bu, bv)
    }

    /// Whether a face of the linear layout is folded; when none is, the chart scaled to its
    /// surface area and taken as parameterised.
    fn fit_barycentric_layout(&mut self) -> bool {
        let mut total = 0f64;
        for face in &self.faces {
            let [a, b, c] = face.verts.map(|v| self.verts[v as usize].uv);
            let area = signed_area_2d(a, b, c) as f64;
            if area < 0.0 {
                return true;
            }
            total += area;
        }
        self.scale(root64(self.area_3d as f64 / total) as f32);
        self.area_2d = self.area_3d;
        self.parameterized = true;
        false
    }
}
