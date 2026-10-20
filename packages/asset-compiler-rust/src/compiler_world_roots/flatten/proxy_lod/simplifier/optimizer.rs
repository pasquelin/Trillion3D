//! The point that minimises a sum of quadrics.
use super::super::super::quadric::{adjugate, outer, times, Plane, Sym3, Volume};
use super::attributes::{QuadricAttr, ATTRIBUTES};

/// The quadrics of the vertices a collapse merges, summed to be solved for the cheapest position:
/// their planes, areas and volume terms, and their gradients' products `Σ g gᵀ` and `Σ g d`.
#[derive(Default)]
pub(super) struct Optimizer {
    pub(super) plane: Plane,
    pub(super) area: f64,
    pub(super) volume: Volume,
    pub(super) bbt: Sym3,
    pub(super) bd: [f64; 3],
}

impl Optimizer {
    pub(super) fn add_attr(&mut self, q: &QuadricAttr) {
        self.plane.add(&q.plane);
        self.area += q.area;
        self.volume.add(&q.volume);
        for i in 0..ATTRIBUTES {
            for (x, y) in self.bbt.iter_mut().zip(outer(q.g[i], q.g[i])) {
                *x += y;
            }
        }
        for i in 0..ATTRIBUTES {
            for k in 0..3 {
                self.bd[k] += q.g[i][k] * q.d[i];
            }
        }
    }

    /// The cheapest position: under the volume constraint (its Lagrange row added) when the
    /// constraint's normal is not null, unconstrained otherwise; `None` when singular.
    pub(super) fn optimize(&self) -> Option<[f64; 3]> {
        let ia = 1.0 / self.area;
        let m: Sym3 = std::array::from_fn(|k| self.plane.a[k] - ia * self.bbt[k]);
        let abddn: [f64; 3] = std::array::from_fn(|k| ia * self.bd[k] - self.plane.b[k]);
        let [nvx, nvy, nvz] = self.volume.n;
        if !(nvx * nvx + nvy * nvy + nvz * nvz > 1e-8) {
            let (adj, det) = adjugate(&m);
            if det.abs() < 1e-8 {
                return None;
            }
            let inv_det = 1.0 / det;
            return Some(times(&adj, abddn).map(|x| inv_det * x));
        }
        let [mxx, mxy, mxz, myy, myz, mzz] = m;
        let [abddnx, abddny, abddnz] = abddn;
        let dv = self.volume.d;
        let det2_01_01 = mxx * myy - mxy * mxy;
        let det2_01_02 = mxx * myz - mxz * mxy;
        let det2_01_12 = mxy * myz - mxz * myy;
        let det2_01_03 = mxx * nvy - nvx * mxy;
        let det2_01_13 = mxy * nvy - nvx * myy;
        let det2_01_23 = mxz * nvy - nvx * myz;
        let inv_x = mzz * det2_01_13 - myz * det2_01_23 - nvz * det2_01_12;
        let inv_y = mxz * det2_01_23 - mzz * det2_01_03 + nvz * det2_01_02;
        let inv_z = myz * det2_01_03 - mxz * det2_01_13 - nvz * det2_01_01;
        let det = inv_x * nvx + inv_y * nvy + inv_z * nvz;
        if det.abs() < 1e-8 {
            return None;
        }
        let inv_det = 1.0 / det;
        let det2_03_02 = mxx * nvz - mxz * nvx;
        let det2_03_12 = mxy * nvz - mxz * nvy;
        let det2_13_12 = myy * nvz - myz * nvy;
        let det2_03_03 = -nvx * nvx;
        let det2_03_13 = -nvx * nvy;
        let det2_03_23 = -nvx * nvz;
        let det2_13_13 = -nvy * nvy;
        let det2_13_23 = -nvy * nvz;
        let imxx = mzz * det2_13_13 - myz * det2_13_23 - nvz * det2_13_12;
        let imxy = myz * det2_03_23 - mzz * det2_03_13 + nvz * det2_03_12;
        let imyy = mzz * det2_03_03 - mxz * det2_03_23 - nvz * det2_03_02;
        let imxz = nvy * det2_01_23 - nvz * det2_01_13;
        let imyz = nvz * det2_01_03 - nvx * det2_01_23;
        let imzz = nvx * det2_01_13 - nvy * det2_01_03;
        Some([
            inv_det * (abddnx * imxx + abddny * imxy + abddnz * imxz - inv_x * dv),
            inv_det * (abddnx * imxy + abddny * imyy + abddnz * imyz - inv_y * dv),
            inv_det * (abddnx * imxz + abddny * imyz + abddnz * imzz - inv_z * dv),
        ])
    }
}
