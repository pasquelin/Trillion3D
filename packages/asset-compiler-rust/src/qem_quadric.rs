//! The error quadrics of the simplifier: the plane quadric of Garland & Heckbert (1997) carried
//! over the vertex attributes as Hoppe (1999) does and minimised in closed form as Hoppe (2000)
//! shows, with a volume constraint, an edge quadric for open and attribute borders, and the
//! optimiser that places a merged point.
//!
//! A triangle's quadric measures, for a position `p` and weighed attribute values `s`, the
//! area-weighted squared distance from `p` to the triangle's plane and from each `sⱼ` to the
//! value the triangle interpolates at `p`:
//!
//! `Q(p, s) = pᵀCp + 2·dnᵀp + d2 + Σⱼ (a·sⱼ² − 2·sⱼ·(gⱼ·p + dⱼ))`
//!
//! with `a` the triangle's area. Every quadric is computed from the triangle as it is now; a
//! merge sums the quadrics of the live triangles around it, each rebased to the merge's first
//! position so that the sums keep their terms small.
//!
//! A quadric is a flat row of doubles: `C` (xx yy zz xy xz yz), `dn` (3), `d2`, `a`, the volume
//! normal `nv` (3, twice the area) and offset `dv`, then the attributes' gradients `g` (3 per
//! attribute) and offsets `d` (1 per attribute).

pub(super) type V3 = [f64; 3];

use trillion3d_math::vec3::cross;
use trillion3d_math::vecn::{dot, scale, sub};

const C: usize = 0;
const DN: usize = 6;
const D2: usize = 9;
pub(super) const AREA: usize = 10;
const NV: usize = 11;
const DV: usize = 14;
/// Doubles of a quadric before its attributes.
const HEAD: usize = 15;

/// The doubles of a quadric with `m` attribute floats.
pub(super) fn size(m: usize) -> usize {
    HEAD + 4 * m
}

/// The single-precision `1e-8` a quadric's area and an edge's length are held against.
const SMALL: f64 = 1e-8_f32 as f64;

/// A position of the simplifier, as doubles.
pub(super) fn wide(p: [f32; 3]) -> V3 {
    p.map(f64::from)
}

/// `C·p` of a quadric's symmetric `C` (xx yy zz xy xz yz).
fn c_times(c: &[f64], p: V3) -> V3 {
    [
        dot(p, [c[0], c[3], c[4]]),
        dot(p, [c[3], c[1], c[5]]),
        dot(p, [c[4], c[5], c[2]]),
    ]
}

/// LU factorisation with partial pivoting of the `n × n` row-major `a`, in place; false when a
/// pivot falls under `epsilon`: the matrix is singular.
fn lup_factorize(a: &mut [f64], pivot: &mut [usize], n: usize, epsilon: f64) -> bool {
    for (i, p) in pivot.iter_mut().enumerate().take(n) {
        *p = i;
    }
    for i in 0..n {
        let (mut max_value, mut max_index) = (a[n * i + i].abs(), i);
        for j in i + 1..n {
            let v = a[n * j + i].abs();
            if v > max_value {
                max_value = v;
                max_index = j;
            }
        }
        if max_value < epsilon {
            return false;
        }
        if max_index != i {
            pivot.swap(i, max_index);
            for j in 0..n {
                a.swap(n * i + j, n * max_index + j);
            }
        }
        for j in i + 1..n {
            a[n * j + i] /= a[n * i + i];
            for k in i + 1..n {
                a[n * j + k] -= a[n * j + i] * a[n * i + k];
            }
        }
    }
    true
}

/// `x` solving `LU·x = b` permuted by `pivot`.
fn lup_solve(lu: &[f64], pivot: &[usize], n: usize, b: &[f64], x: &mut [f64]) {
    for i in 0..n {
        x[i] = b[pivot[i]];
        for j in 0..i {
            x[i] -= lu[n * i + j] * x[j];
        }
    }
    for i in (0..n).rev() {
        for j in i + 1..n {
            x[i] -= lu[n * i + j] * x[j];
        }
        x[i] /= lu[n * i + i];
    }
}

/// `lup_solve` refined by up to four Newton steps against `a`; true once a step's mean squared
/// correction falls under 1e-4.
fn lup_solve_iterate(
    a: &[f64],
    lu: &[f64],
    pivot: &[usize],
    n: usize,
    b: &[f64],
    x: &mut [f64],
) -> bool {
    lup_solve(lu, pivot, n, b, x);
    let (mut residual, mut error) = ([0.0; 4], [0.0; 4]);
    for _ in 0..4 {
        for i in 0..n {
            residual[i] = b[i];
            for j in 0..n {
                residual[i] -= a[n * i + j] * x[j];
            }
        }
        lup_solve(lu, pivot, n, &residual[..n], &mut error[..n]);
        let mut mean_squared = 0.0;
        for i in 0..n {
            x[i] += error[i];
            mean_squared += error[i] * error[i];
        }
        if mean_squared < f64::from(1e-4_f32) {
            return true;
        }
    }
    false
}

/// Writes into `q` the quadric of the triangle `p` with weighed attributes `s` (each `weights[i]`
/// times its float, read in single precision); a triangle under 1e-12 of area writes zeros.
pub(super) fn triangle(q: &mut [f64], p: [V3; 3], s: [&[f32]; 3], weights: &[f32]) {
    let m = weights.len();
    q.fill(0.0);
    let (p01, p02) = (sub(p[1], p[0]), sub(p[2], p[0]));
    let mut n = cross(p02, p01);
    q[NV..NV + 3].copy_from_slice(&n);
    q[DV] = -dot(n, p[0]);
    let length = dot(n, n).sqrt();
    let area = 0.5 * length;
    if !(area >= 1e-12) {
        q[NV..NV + 3].fill(0.0);
        q[DV] = 0.0;
        return;
    }
    n = scale(n, 1.0 / length);
    let mut c = [
        n[0] * n[0],
        n[1] * n[1],
        n[2] * n[2],
        n[0] * n[1],
        n[0] * n[2],
        n[1] * n[2],
    ];
    let dist = -dot(n, p[0]);
    let mut dn = scale(n, dist);
    let mut d2 = dist * dist;
    let a_rows = [
        p01[0], p01[1], p01[2], p02[0], p02[1], p02[2], n[0], n[1], n[2],
    ];
    let mut lu = a_rows;
    let mut pivot = [0usize; 3];
    let invertible = lup_factorize(&mut lu, &mut pivot, 3, 1e-12);
    for i in 0..m {
        let gi = HEAD + 3 * i;
        let di = HEAD + 3 * m + i;
        if weights[i] == 0.0 {
            continue;
        }
        let finite = |x: f32| if x.is_finite() { x } else { 0.0 };
        let [a0, a1, a2] = [0, 1, 2].map(|k| finite(weights[i] * s[k][i]));
        let mut grad = [0.0; 3];
        if invertible {
            let b = [f64::from(a1 - a0), f64::from(a2 - a0), 0.0];
            lup_solve(&lu, &pivot, 3, &b, &mut grad);
            let residual = [
                b[0] - dot(grad, p01),
                b[1] - dot(grad, p02),
                b[2] - dot(grad, n),
            ];
            let mut error = [0.0; 3];
            lup_solve(&lu, &pivot, 3, &residual, &mut error);
            grad = [grad[0] + error[0], grad[1] + error[1], grad[2] + error[2]];
        }
        let d = f64::from(a0) - dot(grad, p[0]);
        q[gi..gi + 3].copy_from_slice(&grad);
        q[di] = d;
        c[0] += grad[0] * grad[0];
        c[1] += grad[1] * grad[1];
        c[2] += grad[2] * grad[2];
        c[3] += grad[0] * grad[1];
        c[4] += grad[0] * grad[2];
        c[5] += grad[1] * grad[2];
        dn = [
            dn[0] + d * grad[0],
            dn[1] + d * grad[1],
            dn[2] + d * grad[2],
        ];
        d2 += d * d;
    }
    for (k, v) in c.iter().enumerate() {
        q[C + k] = v * area;
    }
    q[DN..DN + 3].copy_from_slice(&scale(dn, area));
    q[D2] = d2 * area;
    for v in &mut q[HEAD..HEAD + 4 * m] {
        *v *= area;
    }
    q[AREA] = area;
}

/// The weighed value of attribute float `i` of `values`, read in single precision.
fn weighed(weights: &[f32], values: &[f32], i: usize) -> f64 {
    f64::from(weights[i] * values[i])
}

/// Expresses quadric `q` about `point`, whose attributes are `values`: its plane and attribute
/// offsets measured from there. A quadric under 1e-12 of area stays as it is.
pub(super) fn rebase(q: &mut [f64], point: V3, values: &[f32], weights: &[f32]) {
    let a = q[AREA];
    if a < 1e-12 {
        return;
    }
    let m = weights.len();
    let inv_a = 1.0 / a;
    let nv = [q[NV], q[NV + 1], q[NV + 2]];
    let dist2a = -dot(nv, point);
    let dist_half = 0.25 * dist2a * inv_a;
    let mut dn = scale(nv, dist_half);
    let mut d2 = dist_half * dist2a;
    q[DV] = dist2a;
    for i in 0..m {
        if weights[i] == 0.0 {
            continue;
        }
        let gi = HEAD + 3 * i;
        let g = [q[gi], q[gi + 1], q[gi + 2]];
        let qd = weighed(weights, values, i) - dot(g, point) * inv_a;
        let d = qd * a;
        q[HEAD + 3 * m + i] = d;
        dn = [dn[0] + qd * g[0], dn[1] + qd * g[1], dn[2] + qd * g[2]];
        d2 += qd * d;
    }
    q[DN..DN + 3].copy_from_slice(&dn);
    q[D2] = d2;
}

/// Adds quadric `q`, expressed about `point` whose attributes are `values`, to the sum `into`.
pub(super) fn add_about(into: &mut [f64], q: &[f64], point: V3, values: &[f32], weights: &[f32]) {
    let qa = q[AREA];
    if qa < 1e-12 {
        return;
    }
    let m = weights.len();
    for k in 0..6 {
        into[C + k] += q[C + k];
    }
    let inv_a = 1.0 / qa;
    let nv = [q[NV], q[NV + 1], q[NV + 2]];
    let dist2a = -dot(nv, point);
    let dist_half = 0.25 * dist2a * inv_a;
    for k in 0..3 {
        into[DN + k] += dist_half * nv[k];
        into[NV + k] += nv[k];
    }
    into[D2] += dist_half * dist2a;
    into[DV] += dist2a;
    for i in 0..m {
        if weights[i] == 0.0 {
            continue;
        }
        let gi = HEAD + 3 * i;
        let g = [q[gi], q[gi + 1], q[gi + 2]];
        let qd = weighed(weights, values, i) - dot(g, point) * inv_a;
        let qda = qd * qa;
        for k in 0..3 {
            into[gi + k] += g[k];
            into[DN + k] += qd * g[k];
        }
        into[HEAD + 3 * m + i] += qda;
        into[D2] += qd * qda;
    }
    into[AREA] += qa;
}

/// `pᵀCp + 2·dnᵀp + d2`: the quadric's error at `p` before its attributes.
fn geometric(q: &[f64], p: V3) -> f64 {
    dot(p, c_times(&q[C..C + 6], p)) + 2.0 * dot(p, [q[DN], q[DN + 1], q[DN + 2]]) + q[D2]
}

/// `Q(p, s)` with `s` the weighed `values`; a negative or non-finite result reads 0.
pub(super) fn evaluate(q: &[f64], p: V3, values: &[f32], weights: &[f32]) -> f32 {
    let m = weights.len();
    let a = q[AREA];
    let mut total = geometric(q, p);
    for i in 0..m {
        let gi = HEAD + 3 * i;
        let pgd = dot(p, [q[gi], q[gi + 1], q[gi + 2]]) + q[HEAD + 3 * m + i];
        let s = weighed(weights, values, i);
        total += s * (a * s - 2.0 * pgd);
    }
    clean(total)
}

/// `Q(p, s)` with every weighed attribute at its best value at `p`, written into `values`
/// unweighed; the floats of zero weight are left as they are.
pub(super) fn solve_and_evaluate(q: &[f64], p: V3, values: &mut [f32], weights: &[f32]) -> f32 {
    let m = weights.len();
    let a = q[AREA];
    let mut total = geometric(q, p);
    for i in 0..m {
        if weights[i] == 0.0 {
            continue;
        }
        let gi = HEAD + 3 * i;
        let pgd = dot(p, [q[gi], q[gi + 1], q[gi + 2]]) + q[HEAD + 3 * m + i];
        let s = pgd / a;
        values[i] = (s / f64::from(weights[i])) as f32;
        total -= pgd * s;
    }
    clean(total)
}

fn clean(q: f64) -> f32 {
    if q < 0.0 || !q.is_finite() {
        0.0
    } else {
        q as f32
    }
}

/// The quadric of the distance to the line of an edge, weighted by `weight` times its length:
/// `n` its unit direction, `c` (xx yy zz xy xz yz) `a·(I − n nᵀ)`; zero for an edge under 1e-8.
#[derive(Clone, Copy, Default)]
pub(super) struct EdgeQuadric {
    c: [f64; 6],
    n: V3,
    a: f64,
}
impl EdgeQuadric {
    pub fn new(p0: V3, p1: V3, weight: f32) -> Self {
        let n = sub(p1, p0);
        let length = dot(n, n).sqrt();
        if length < SMALL {
            return Self::default();
        }
        let n = scale(n, 1.0 / length);
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
pub(super) struct PositionQuadric {
    c: [f64; 6],
    dn: V3,
    d2: f64,
}
impl PositionQuadric {
    /// Adds edge quadric `e` whose edge starts at `point`.
    pub fn add_edge(&mut self, e: &EdgeQuadric, point: V3) {
        let dist = -dot(e.n, point);
        for k in 0..6 {
            self.c[k] += e.c[k];
        }
        let a_dist = e.a * dist;
        for k in 0..3 {
            self.dn[k] += e.a * -point[k] - a_dist * e.n[k];
        }
        self.d2 += e.a * dot(point, point) - a_dist * dist;
    }
    /// The squared distance it measures at `p`; a negative or non-finite result reads 0.
    pub fn evaluate(&self, p: V3) -> f32 {
        clean(dot(p, c_times(&self.c, p)) + 2.0 * dot(p, self.dn) + self.d2)
    }
}

/// The sums the merged position is solved from: the wedges' quadrics with their attributes
/// eliminated, the volume constraint and the border edges.
#[derive(Default)]
pub(super) struct Optimizer {
    c: [f64; 6],
    dn: V3,
    a: f64,
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
    fn reduced(&self) -> Option<([f64; 6], V3)> {
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
