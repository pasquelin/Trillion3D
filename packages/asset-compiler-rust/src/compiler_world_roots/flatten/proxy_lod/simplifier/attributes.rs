//! Attribute gradients over a triangle and the quadric that carries them.
use super::super::super::quadric::{outer, times, Plane, Volume};
use trillion3d_math::vec3::{cross, unit_where};
use trillion3d_math::vecn::{dot, length, scale, squared_length, sub};

/// The squared length under which a vector counts as null.
pub(super) const SMALL_NUMBER: f32 = 1.0e-8;

pub(super) fn wide(p: [f32; 3]) -> [f64; 3] {
    p.map(f64::from)
}

const SINGULAR_QUADRIC_DET: f64 = 1e-8;

/// `v` scaled to unit length unless that length is under `SMALL_NUMBER`.
fn unit_above_small(v: [f64; 3]) -> Option<[f64; 3]> {
    unit_where(v, |norm| !(norm < f64::from(SMALL_NUMBER)))
}

/// A cost read in single precision, 0 when not finite.
pub(super) fn finite_cost(q: f64) -> f32 {
    (if q.is_finite() { q } else { 0.0 }) as f32
}

/// The inverse of the system whose rows are the triangle's corners and normal: it maps an
/// attribute's three corner values to its gradient over the triangle's plane. `None` when the
/// triangle is too thin to invert (|det| under 1e-8).
fn gradient_matrix(p0: [f64; 3], p1: [f64; 3], p2: [f64; 3], n: [f64; 3]) -> Option<[f64; 12]> {
    let det2_01_01 = p0[0] * p1[1] - p0[1] * p1[0];
    let det2_01_02 = p0[0] * p1[2] - p0[2] * p1[0];
    let det2_01_03 = p0[0] - p1[0];
    let det2_01_12 = p0[1] * p1[2] - p0[2] * p1[1];
    let det2_01_13 = p0[1] - p1[1];
    let det2_01_23 = p0[2] - p1[2];
    let det3_201_013 = p2[0] * det2_01_13 - p2[1] * det2_01_03 + det2_01_01;
    let det3_201_023 = p2[0] * det2_01_23 - p2[2] * det2_01_03 + det2_01_02;
    let det3_201_123 = p2[1] * det2_01_23 - p2[2] * det2_01_13 + det2_01_12;
    let det = -det3_201_123 * n[0] + det3_201_023 * n[1] - det3_201_013 * n[2];
    if det.abs() < SINGULAR_QUADRIC_DET {
        return None;
    }
    let inv_det = 1.0 / det;
    let det2_03_01 = p0[0] * n[1] - p0[1] * n[0];
    let det2_03_02 = p0[0] * n[2] - p0[2] * n[0];
    let det2_03_12 = p0[1] * n[2] - p0[2] * n[1];
    let det2_03_03 = -n[0];
    let det2_03_13 = -n[1];
    let det2_03_23 = -n[2];
    let det2_13_01 = p1[0] * n[1] - p1[1] * n[0];
    let det2_13_02 = p1[0] * n[2] - p1[2] * n[0];
    let det2_13_12 = p1[1] * n[2] - p1[2] * n[1];
    let det2_13_03 = -n[0];
    let det2_13_13 = -n[1];
    let det2_13_23 = -n[2];
    let det3_203_012 = p2[0] * det2_03_12 - p2[1] * det2_03_02 + p2[2] * det2_03_01;
    let det3_203_013 = p2[0] * det2_03_13 - p2[1] * det2_03_03 + det2_03_01;
    let det3_203_023 = p2[0] * det2_03_23 - p2[2] * det2_03_03 + det2_03_02;
    let det3_203_123 = p2[1] * det2_03_23 - p2[2] * det2_03_13 + det2_03_12;
    let det3_213_012 = p2[0] * det2_13_12 - p2[1] * det2_13_02 + p2[2] * det2_13_01;
    let det3_213_013 = p2[0] * det2_13_13 - p2[1] * det2_13_03 + det2_13_01;
    let det3_213_023 = p2[0] * det2_13_23 - p2[2] * det2_13_03 + det2_13_02;
    let det3_213_123 = p2[1] * det2_13_23 - p2[2] * det2_13_13 + det2_13_12;
    let det3_301_012 = n[0] * det2_01_12 - n[1] * det2_01_02 + n[2] * det2_01_01;
    let det3_301_013 = n[0] * det2_01_13 - n[1] * det2_01_03;
    let det3_301_023 = n[0] * det2_01_23 - n[2] * det2_01_03;
    let det3_301_123 = n[1] * det2_01_23 - n[2] * det2_01_13;
    Some([
        det3_213_123 * inv_det,
        det3_213_023 * inv_det,
        det3_213_013 * inv_det,
        det3_213_012 * inv_det,
        det3_203_123 * inv_det,
        det3_203_023 * inv_det,
        det3_203_013 * inv_det,
        det3_203_012 * inv_det,
        det3_301_123 * inv_det,
        det3_301_023 * inv_det,
        det3_301_013 * inv_det,
        det3_301_012 * inv_det,
    ])
}

/// An attribute's gradient (x, y, z) and offset (w) over the triangle from its corner values.
fn gradient(m: &[f64; 12], a0: f32, a1: f32, a2: f32) -> [f64; 4] {
    let (a0, a1, a2) = (f64::from(a0), f64::from(a1), f64::from(a2));
    [
        -m[0] * a0 + m[4] * a1 + m[8] * a2,
        m[1] * a0 - m[5] * a1 - m[9] * a2,
        -m[2] * a0 + m[6] * a1 + m[10] * a2,
        m[3] * a0 - m[7] * a1 - m[11] * a2,
    ]
}

/// The boundary edge quadric: the plane through the edge `p0 → p1` normal to the face, weighted
/// by `edge_weight` times the edge's length; nothing when the face normal is not unit or the edge
/// runs along it.
pub(super) fn edge_quadric(
    p0: [f64; 3],
    p1: [f64; 3],
    face_normal: [f64; 3],
    edge_weight: f32,
) -> Plane {
    if !((1.0 - squared_length(face_normal)).abs() < 0.01) {
        return Plane::default();
    }
    let a = sub(p1, p0);
    let Some(n) = unit_above_small(cross(a, face_normal)) else {
        return Plane::default();
    };
    let dist = -dot(n, p0);
    let weight = f64::from(edge_weight) * length(a);
    let wd = weight * dist;
    Plane {
        a: outer(scale(n, weight), n),
        b: scale(n, wd),
        c: wd * dist,
    }
}

pub(super) const ATTRIBUTES: usize = 3;

/// The quadric with three attributes (Hoppe 1999), each triangle weighted by its area, with the
/// volume constraint terms that keep a collapse from changing the enclosed volume.
#[derive(Clone, Copy, Default)]
pub(crate) struct QuadricAttr {
    pub(super) plane: Plane,
    pub(super) g: [[f64; 3]; ATTRIBUTES],
    pub(super) d: [f64; ATTRIBUTES],
    pub area: f64,
    pub(super) volume: Volume,
}

impl QuadricAttr {
    /// The triangle quadric. Where the gradient matrix is singular the attribute gradients are
    /// read as zeros.
    pub(super) fn new(p: [[f64; 3]; 3], attr: [[f32; 3]; 3]) -> QuadricAttr {
        let [p0, p1, p2] = p;
        let raw = cross(sub(p2, p0), sub(p1, p0));
        let Some(n) = unit_above_small(raw) else {
            return QuadricAttr::default();
        };
        let area = 0.5 * length(raw);
        let dist = -dot(n, p0);
        let mut q = QuadricAttr {
            plane: Plane {
                a: outer(n, n),
                b: scale(n, dist),
                c: dist * dist,
            },
            volume: Volume {
                n: scale(n, area / 3.0),
                d: dist * (area / 3.0),
            },
            ..Default::default()
        };
        let matrix = gradient_matrix(p0, p1, p2, n).unwrap_or([0.0; 12]);
        let clean = |v: f32| if v.is_finite() { v } else { 0.0 };
        for i in 0..ATTRIBUTES {
            let grad = gradient(
                &matrix,
                clean(attr[0][i]),
                clean(attr[1][i]),
                clean(attr[2][i]),
            );
            let (g, d) = ([grad[0], grad[1], grad[2]], grad[3]);
            (q.g[i], q.d[i]) = (g, d);
            for (x, y) in q.plane.a.iter_mut().zip(outer(g, g)) {
                *x += y;
            }
            for k in 0..3 {
                q.plane.b[k] += d * g[k];
            }
            q.plane.c += d * d;
        }
        q.plane.a = q.plane.a.map(|v| v * area);
        q.plane.b = scale(q.plane.b, area);
        q.plane.c *= area;
        for i in 0..ATTRIBUTES {
            q.g[i] = scale(q.g[i], area);
            q.d[i] *= area;
        }
        q.area = area;
        q
    }

    pub(super) fn add(&mut self, q: &QuadricAttr) {
        self.plane.add(&q.plane);
        for i in 0..ATTRIBUTES {
            for k in 0..3 {
                self.g[i][k] += q.g[i][k];
            }
            self.d[i] += q.d[i];
        }
        self.area += q.area;
        self.volume.add(&q.volume);
    }

    /// The cost of `p` carrying `attributes`: the plane distance plus the attribute error, 0 when
    /// not finite.
    pub(super) fn evaluate(&self, p: [f64; 3], attributes: [f32; 3]) -> f32 {
        let [px, py, pz] = p;
        let s = attributes.map(f64::from);
        let [mut x, mut y, mut z] = times(&self.plane.a, p);
        for i in 0..ATTRIBUTES {
            x -= self.g[i][0] * s[i];
            y -= self.g[i][1] * s[i];
            z -= self.g[i][2] * s[i];
        }
        let mut vav = dot(p, [x, y, z]);
        for i in 0..ATTRIBUTES {
            vav += s[i]
                * (self.area * s[i] - self.g[i][0] * px - self.g[i][1] * py - self.g[i][2] * pz);
        }
        let mut btv = dot(p, self.plane.b);
        for i in 0..ATTRIBUTES {
            btv -= self.d[i] * s[i];
        }
        finite_cost(vav + 2.0 * btv + self.plane.c)
    }

    /// The attributes the quadric predicts at `p`.
    pub(super) fn attributes(&self, p: [f64; 3]) -> [f32; 3] {
        std::array::from_fn(|i| ((dot(self.g[i], p) + self.d[i]) / self.area) as f32)
    }
}
