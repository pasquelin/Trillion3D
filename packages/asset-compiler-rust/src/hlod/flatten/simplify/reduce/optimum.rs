//! The point a collapse moves its vertices to: the least of the summed quadrics once the normal's
//! components are eliminated, `(C − B Bᵀ / a) p = B d / a − b` with `C` the quadratic terms, `B`
//! the gradients, `d` their offsets, `b` the linear terms and `a` the area. The point is held on
//! the plane that keeps the enclosed volume when the volume terms are well conditioned — the 4×4
//! system bordered by the constraint, solved by cofactors —, else the 3×3 system is solved alone
//! (`quadric::adjugate`). Either system under the singular threshold gives no point.
use super::quadric::{NormalQuadric, PlaneQuadric, SINGULAR};
use crate::hlod::flatten::quadric::{adjugate, outer, times, Sym3, Volume};
use trillion3d_math::vector::vecn::{add, scale, squared_length, sub};

type V3 = [f64; 3];

/// The squared length of the volume terms' normal over which the constraint is held.
const CONDITIONED: f64 = 1e-8;

/// The sums the optimal point solves from: each quadric's quadratic and linear terms and area, the
/// triangles' volume terms, the gradients' products `B Bᵀ` and `B d`.
#[derive(Default)]
pub(super) struct Optimum {
    a: Sym3,
    b: V3,
    area: f64,
    volume: Volume,
    gradients: Sym3,
    offsets: V3,
}

impl Optimum {
    /// A boundary quadric added: its plane and area only.
    pub(super) fn add_plane(&mut self, q: &PlaneQuadric) {
        self.a = add(self.a, q.plane.a);
        self.b = add(self.b, q.plane.b);
        self.area += q.area;
    }

    /// A triangles' quadric added, its volume terms and gradients with it.
    pub(super) fn add_normal(&mut self, q: &NormalQuadric) {
        self.a = add(self.a, q.plane.a);
        self.b = add(self.b, q.plane.b);
        self.area += q.area;
        self.volume.add_scaled(1.0, &q.volume);
        for (&g, &d) in q.gradients.iter().zip(&q.offsets) {
            self.gradients = add(self.gradients, outer(g, g));
            self.offsets = add(self.offsets, scale(g, d));
        }
    }

    /// The optimal point, `None` where the system is singular.
    pub(super) fn solve(&self) -> Option<V3> {
        let inverse_area = 1.0 / self.area;
        let m: Sym3 = core::array::from_fn(|k| self.a[k] - inverse_area * self.gradients[k]);
        let r: V3 = core::array::from_fn(|k| inverse_area * self.offsets[k] - self.b[k]);
        if squared_length(self.volume.n) > CONDITIONED {
            constrained(&m, r, &self.volume)
        } else {
            let (adj, det) = adjugate(&m);
            if det.abs() < SINGULAR {
                return None;
            }
            Some(scale(times(&adj, r), 1.0 / det))
        }
    }
}

/// `M p = r` held on the plane `n · p = −d` of the volume terms: the 4×4 system `[M n; nᵀ 0]`
/// inverted by cofactors, its minors named by their rows and columns (`x`, `y`, `z`, and `n` for
/// the constraint's).
fn constrained(m: &Sym3, r: V3, volume: &Volume) -> Option<V3> {
    let [mxx, mxy, mxz, myy, myz, mzz] = *m;
    let [nx, ny, nz] = volume.n;

    // The 2×2 minors of the first two rows.
    let xy_xy = mxx * myy - mxy * mxy;
    let xy_xz = mxx * myz - mxz * mxy;
    let xy_yz = mxy * myz - mxz * myy;
    let xy_xn = mxx * ny - nx * mxy;
    let xy_yn = mxy * ny - nx * myy;
    let xy_zn = mxz * ny - nx * myz;

    // The constraint column's cofactors, and the determinant along it.
    let cx = mzz * xy_yn - myz * xy_zn - nz * xy_yz;
    let cy = mxz * xy_zn - mzz * xy_xn + nz * xy_xz;
    let cz = myz * xy_xn - mxz * xy_yn - nz * xy_xy;
    let det = cx * nx + cy * ny + cz * nz;
    if det.abs() < SINGULAR {
        return None;
    }
    let inverse = 1.0 / det;

    // The 2×2 minors of a row with the constraint's.
    let xn_xz = mxx * nz - mxz * nx;
    let xn_yz = mxy * nz - mxz * ny;
    let yn_yz = myy * nz - myz * ny;
    let xn_xn = -nx * nx;
    let xn_yn = -nx * ny;
    let xn_zn = -nx * nz;
    let yn_yn = -ny * ny;
    let yn_zn = -ny * nz;

    // The inverse's position block, symmetric, before the determinant.
    let ixx = mzz * yn_yn - myz * yn_zn - nz * yn_yz;
    let ixy = myz * xn_zn - mzz * xn_yn + nz * xn_yz;
    let iyy = mzz * xn_xn - mxz * xn_zn - nz * xn_xz;
    let ixz = ny * xy_zn - nz * xy_yn;
    let iyz = nz * xy_xn - nx * xy_zn;
    let izz = nx * xy_yn - ny * xy_xn;

    let rows = times(&[ixx, ixy, ixz, iyy, iyz, izz], r);
    Some(scale(sub(rows, scale([cx, cy, cz], volume.d)), inverse))
}
