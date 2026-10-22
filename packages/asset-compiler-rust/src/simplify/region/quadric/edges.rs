//! The border quadrics: an edge's distance-to-line quadric and the sum of them a merged position
//! is weighed with.
use super::{c_times, clean, SMALL, V3};
use trillion3d_math::vector::vec3::divide;
use trillion3d_math::vector::vecn::{dot, sub};

/// The quadric of the distance to the line of an edge, weighted by `weight` times its length:
/// `n` its unit direction, `c` (xx yy zz xy xz yz) `a·(I − n nᵀ)`; zero for an edge under 1e-8.
#[derive(Clone, Copy, Default)]
pub(crate) struct EdgeQuadric {
    c: [f64; 6],
    pub(crate) n: V3,
    pub(crate) a: f64,
}
impl EdgeQuadric {
    pub fn new(p0: V3, p1: V3, weight: f32) -> Self {
        let n = sub(p1, p0);
        let length = dot(n, n).sqrt();
        if length < SMALL {
            return Self::default();
        }
        let n = divide(n, length);
        let a = f64::from(weight) * length;
        Self {
            c: [
                a - a * n[0] * n[0],
                a - a * n[1] * n[1],
                a - a * n[2] * n[2],
                -a * n[0] * n[1],
                -a * n[0] * n[2],
                -a * n[1] * n[2],
            ],
            n,
            a,
        }
    }
}

/// A quadric of the position alone, summing edge quadrics about a point.
#[derive(Clone, Copy, Default)]
pub(crate) struct PositionQuadric {
    pub(super) c: [f64; 6],
    pub(super) dn: V3,
    pub(super) d2: f64,
}
impl PositionQuadric {
    /// Adds edge quadric `e` whose edge starts at `point`.
    pub fn add_edge(&mut self, e: &EdgeQuadric, point: V3) {
        let dist = -dot(e.n, point);
        for k in 0..6 {
            self.c[k] += e.c[k];
        }
        let a_dist = e.a * dist;
        for (k, &component) in point.iter().enumerate() {
            self.dn[k] += e.a * -component - a_dist * e.n[k];
        }
        self.d2 += e.a * dot(point, point) - a_dist * dist;
    }
    /// The squared distance it measures at `p`; a negative or non-finite result reads 0.
    pub fn evaluate(&self, p: V3) -> f32 {
        clean(dot(p, c_times(&self.c, p)) + 2.0 * dot(p, self.dn) + self.d2)
    }
}
