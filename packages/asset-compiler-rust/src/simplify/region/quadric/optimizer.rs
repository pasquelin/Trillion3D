//! The optimiser that places a merged point: the wedges' quadrics with their attributes
//! eliminated, the volume constraint and the border edges, solved in closed form.
use super::edges::PositionQuadric;
use super::lup::{lup_factorize, lup_solve_iterate};
use super::{c_times, AREA, C, DN, DV, HEAD, NV, SMALL, V3};
use trillion3d_math::vector::vecn::{dot, sub};

/// The sums the merged position is solved from: the wedges' quadrics with their attributes
/// eliminated, the volume constraint and the border edges.
#[derive(Default)]
pub(crate) struct Optimizer {
    c: [f64; 6],
    dn: V3,
    pub(crate) a: f64,
    nv: V3,
    dv: f64,
    bbt: [f64; 6],
    bd: V3,
}
impl Optimizer {
    pub fn add_edges(&mut self, q: &PositionQuadric) {
        for k in 0..6 {
            self.c[k] += q.c[k];
        }
        for k in 0..3 {
            self.dn[k] += q.dn[k];
        }
    }
    /// Adds a wedge's quadric with `m` attribute floats; one under 1e-8 of area adds nothing.
    pub fn add_quadric(&mut self, q: &[f64], m: usize) {
        if q[AREA] < SMALL {
            return;
        }
        for k in 0..6 {
            self.c[k] += q[C + k];
        }
        for k in 0..3 {
            self.dn[k] += q[DN + k];
            self.nv[k] += q[NV + k];
        }
        self.a += q[AREA];
        self.dv += q[DV];
        for i in 0..m {
            let gi = HEAD + 3 * i;
            let g = [q[gi], q[gi + 1], q[gi + 2]];
            let d = q[HEAD + 3 * m + i];
            self.bbt[0] += g[0] * g[0];
            self.bbt[1] += g[1] * g[1];
            self.bbt[2] += g[2] * g[2];
            self.bbt[3] += g[0] * g[1];
            self.bbt[4] += g[0] * g[2];
            self.bbt[5] += g[1] * g[2];
            for k in 0..3 {
                self.bd[k] += g[k] * d;
            }
        }
    }

    /// `M = C − BBᵀ/a` and `b = Bd/a − dn`, or `None` under 1e-12 of area.
    pub(crate) fn reduced(&self) -> Option<([f64; 6], V3)> {
        if self.a < 1e-12 {
            return None;
        }
        let inv_a = 1.0 / self.a;
        let m: [f64; 6] = std::array::from_fn(|k| self.c[k] - self.bbt[k] * inv_a);
        let b = [0, 1, 2].map(|k| self.bd[k] * inv_a - self.dn[k]);
        Some((m, b))
    }

    /// The position of least error, if the system is well posed.
    pub fn optimize(&self) -> Option<V3> {
        let (m, b) = self.reduced()?;
        let full = [m[0], m[3], m[4], m[3], m[1], m[5], m[4], m[5], m[2]];
        let mut lu = full;
        let mut pivot = [0usize; 3];
        if !lup_factorize(&mut lu, &mut pivot, 3, 1e-12) {
            return None;
        }
        let mut p = [0.0; 3];
        lup_solve_iterate(&full, &lu, &pivot, 3, &b, &mut p).then_some(p)
    }

    /// The position of least error that keeps the volume, if that constraint is well posed.
    pub fn optimize_volume(&self) -> Option<V3> {
        let (m, b) = self.reduced()?;
        let nv = self.nv;
        if dot(nv, nv) <= 1e-12 {
            return None;
        }
        let full = [
            m[0], m[3], m[4], nv[0], //
            m[3], m[1], m[5], nv[1], //
            m[4], m[5], m[2], nv[2], //
            nv[0], nv[1], nv[2], 0.0,
        ];
        let rhs = [b[0], b[1], b[2], -self.dv];
        let mut lu = full;
        let mut pivot = [0usize; 4];
        if !lup_factorize(&mut lu, &mut pivot, 4, 1e-12) {
            return None;
        }
        let mut p = [0.0; 4];
        lup_solve_iterate(&full, &lu, &pivot, 4, &rhs, &mut p).then_some([p[0], p[1], p[2]])
    }

    /// The position of least error on the segment from `p0` to `p1`, keeping the volume when that
    /// constraint is well posed, if the error varies along it.
    pub fn optimize_linear(&self, p0: V3, p1: V3) -> Option<V3> {
        let (m, b) = self.reduced()?;
        let m0 = c_times(&m, p0);
        let m1 = c_times(&m, p1);
        let m01 = sub(m1, m0);
        let m01_sqr = dot(m01, m01);
        if m01_sqr < 1e-16 {
            return None;
        }
        let bm0 = sub(b, m0);
        let mut t = dot(m01, bm0) / m01_sqr;
        let nv = self.nv;
        let nv_sqr = dot(nv, nv);
        if nv_sqr > 1e-12 {
            let nv0 = dot(nv, p0);
            let nv01 = dot(nv, p1) - nv0;
            let ata_xx = m01_sqr + nv01 * nv01;
            let ata_xy = dot(m01, nv);
            let ata_yy = nv_sqr;
            let det = ata_xx * ata_yy - ata_xy * ata_xy;
            if det.abs() > 1e-16 {
                let atb = [dot(m01, bm0) - (self.dv + nv0) * nv01, dot(nv, bm0)];
                t = (ata_yy * atb[0] - ata_xy * atb[1]) / det;
            }
        }
        let t = t.clamp(0.0, 1.0);
        Some([0, 1, 2].map(|k| p0[k] * (1.0 - t) + p1[k] * t))
    }
}
