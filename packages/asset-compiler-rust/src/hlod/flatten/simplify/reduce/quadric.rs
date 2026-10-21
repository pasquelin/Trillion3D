//! The error quadrics a collapse is priced with, in double precision over the single-precision
//! mesh (Garland & Heckbert 1997). A triangle's quadric (`NormalQuadric`) holds its plane, the
//! linear gradient of each of its normal's three components across it (Hoppe 1999) — solved from
//! the corners by `gradient` — and the terms of the plane that keeps the enclosed volume (Lindstrom
//! & Turk 1998), all weighted by its area; a boundary edge's quadric (`PlaneQuadric`) holds the
//! plane through the edge at right angles to its face, weighted by the edge's length.
//!
//! The normal's three components weigh one each, so each weighted component is the component
//! itself. A quadric that evaluates to a value that is not finite gives zero. Every sum runs in
//! the order written, from its first term (`vecn`), so it keeps its bits.
use crate::hlod::flatten::quadric::{outer, times, Plane, Volume};
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{add, dot, scale, squared_length, sub};

mod gradient;

type V3 = [f64; 3];

/// The determinant under which a quadric's system counts as singular.
pub(super) const SINGULAR: f64 = 1e-8;
/// The normal's length under which a triangle or an edge carries no plane: single precision's
/// small number, widened.
const DEGENERATE: f64 = 1.0e-8_f32 as f64;
/// How far a face normal's squared length may stray from one for its edge to be priced.
const UNIT_SLACK: f64 = 0.01_f32 as f64;

/// `q`, or zero when it is not finite.
fn finite_or_zero(q: f64) -> f64 {
    if q.is_finite() {
        q
    } else {
        0.0
    }
}

/// `n` times the reciprocal of its length, and that length.
fn unit_and_length(n: V3) -> (V3, f64) {
    let length = squared_length(n).sqrt();
    (scale(n, 1.0 / length), length)
}

/// A sum of boundary edges' planes, and the area summed with them: zero for an edge's own.
#[derive(Clone, Copy, Default)]
pub(super) struct PlaneQuadric {
    pub plane: Plane,
    pub area: f64,
}

impl PlaneQuadric {
    /// The plane through the edge from `p0` to `p1` at right angles to its face's normal `face`,
    /// weighted by `weight` times the edge's length; zero when `face` is not of unit length (its
    /// squared length off one by `UNIT_SLACK` or more) or the edge runs along it.
    pub(super) fn of_edge(p0: V3, p1: V3, face: V3, weight: f32) -> Self {
        let unit = (1.0 - squared_length(face)).abs() < UNIT_SLACK;
        if !unit {
            return Self::default();
        }
        let along = sub(p1, p0);
        let (n, length) = unit_and_length(cross(along, face));
        let edge_length = squared_length(along).sqrt();
        if length < DEGENERATE {
            return Self::default();
        }
        let dist = -dot(n, p0);
        let w = f64::from(weight) * edge_length;
        let wd = w * dist;
        Self {
            plane: Plane {
                a: outer(scale(n, w), n),
                b: scale(n, wd),
                c: wd * dist,
            },
            area: 0.0,
        }
    }

    /// `o` added, term by term: at weight one, each as it is.
    pub(super) fn add(&mut self, o: &Self) {
        self.plane.add_scaled(1.0, &o.plane);
        self.area += o.area;
    }

    /// The squared distance to the planes at `p`.
    pub(super) fn error_at(&self, p: V3) -> f32 {
        finite_or_zero(self.plane.evaluate(p)) as f32
    }
}

/// A sum of triangles' quadrics over the position and the normal's three components.
#[derive(Clone, Copy, Default)]
pub(super) struct NormalQuadric {
    /// The quadratic, linear and constant terms over the position, the gradients' included.
    pub plane: Plane,
    /// Each normal component's gradient across the triangles and its offset at the origin.
    pub gradients: [V3; 3],
    pub offsets: V3,
    /// The summed area.
    pub area: f64,
    /// The volume constraint's terms, a third of the area each.
    pub volume: Volume,
}

impl NormalQuadric {
    /// The quadric of the triangle on `p` with the corner normals `normals`, a component that is
    /// not finite read as zero; zero when the triangle has no area. Where the corners' system is
    /// singular each component is flat at the corners' mean.
    pub(super) fn of_triangle(p: [V3; 3], normals: [[f32; 3]; 3]) -> Self {
        let (n, length) = unit_and_length(cross(sub(p[2], p[0]), sub(p[1], p[0])));
        if length < DEGENERATE {
            return Self::default();
        }
        let area = 0.5 * length;
        let dist = -dot(n, p[0]);
        let mut plane = Plane {
            a: outer(n, n),
            b: scale(n, dist),
            c: dist * dist,
        };
        let third = area / 3.0;
        let volume = Volume {
            n: scale(n, third),
            d: dist * third,
        };
        let matrix = gradient::matrix(p, n);
        let mut gradients = [[0.0; 3]; 3];
        let mut offsets = [0.0; 3];
        for i in 0..3 {
            let values = normals.map(|normal| {
                if normal[i].is_finite() {
                    normal[i]
                } else {
                    0.0
                }
            });
            let [gx, gy, gz, d] = match &matrix {
                Some(matrix) => gradient::apply(matrix, values),
                None => [
                    0.0,
                    0.0,
                    0.0,
                    f64::from(values[0] + values[1] + values[2]) / 3.0,
                ],
            };
            let g = [gx, gy, gz];
            plane.a = add(plane.a, outer(g, g));
            plane.b = add(plane.b, scale(g, d));
            plane.c += d * d;
            gradients[i] = g;
            offsets[i] = d;
        }
        Self {
            plane: Plane {
                a: scale(plane.a, area),
                b: scale(plane.b, area),
                c: plane.c * area,
            },
            gradients: gradients.map(|g| scale(g, area)),
            offsets: scale(offsets, area),
            area,
            volume,
        }
    }

    /// `o` added, term by term: at weight one, each as it is.
    pub(super) fn add(&mut self, o: &Self) {
        self.plane.add_scaled(1.0, &o.plane);
        for (g, og) in self.gradients.iter_mut().zip(&o.gradients) {
            *g = add(*g, *og);
        }
        self.offsets = add(self.offsets, o.offsets);
        self.area += o.area;
        self.volume.add_scaled(1.0, &o.volume);
    }

    /// The error at `p` carrying `normal`: the position's quadratic form less the gradients'
    /// cross terms, the normal's own terms, twice the linear terms and the constant.
    pub(super) fn error_at(&self, p: V3, normal: [f32; 3]) -> f32 {
        let s = normal.map(f64::from);
        let mut row = times(&self.plane.a, p);
        for (g, &si) in self.gradients.iter().zip(&s) {
            for (r, gk) in row.iter_mut().zip(g) {
                *r -= gk * si;
            }
        }
        let mut quadratic = dot(p, row);
        for (g, &si) in self.gradients.iter().zip(&s) {
            quadratic += si * (self.area * si - g[0] * p[0] - g[1] * p[1] - g[2] * p[2]);
        }
        let mut linear = dot(p, self.plane.b);
        for (&d, &si) in self.offsets.iter().zip(&s) {
            linear -= d * si;
        }
        finite_or_zero(quadratic + 2.0 * linear + self.plane.c) as f32
    }

    /// The normal the quadric gives `p`, each component its gradient's value there over the area;
    /// not normalized.
    pub(super) fn normal_at(&self, p: V3) -> [f32; 3] {
        core::array::from_fn(|i| ((dot(self.gradients[i], p) + self.offsets[i]) / self.area) as f32)
    }
}
