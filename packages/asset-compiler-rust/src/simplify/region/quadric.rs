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
//!
//! Children: the dense solver (`lup`), the border quadrics (`edges`) and the optimiser that
//! places a merged point (`optimizer`).

pub(crate) type V3 = [f64; 3];

use trillion3d_math::scalar::not_at_least;
use trillion3d_math::vector::vec3::{cross, divide};
use trillion3d_math::vector::vecn::{dot, scale, sub};

mod edges;
mod lup;
mod optimizer;
pub(crate) use edges::{EdgeQuadric, PositionQuadric};
use lup::{lup_factorize, lup_solve};
pub(crate) use optimizer::Optimizer;

pub(super) const C: usize = 0;
pub(super) const DN: usize = 6;
pub(super) const D2: usize = 9;
pub(crate) const AREA: usize = 10;
pub(super) const NV: usize = 11;
pub(super) const DV: usize = 14;
/// Doubles of a quadric before its attributes.
pub(super) const HEAD: usize = 15;

/// The doubles of a quadric with `m` attribute floats.
pub(crate) fn size(m: usize) -> usize {
    HEAD + 4 * m
}

/// The single-precision `1e-8` a quadric's area and an edge's length are held against.
pub(super) const SMALL: f64 = 1e-8_f32 as f64;

/// A position of the simplifier, as doubles.
pub(crate) fn wide(p: [f32; 3]) -> V3 {
    p.map(f64::from)
}

/// `C·p` of a quadric's symmetric `C` (xx yy zz xy xz yz).
pub(super) fn c_times(c: &[f64], p: V3) -> V3 {
    [
        dot(p, [c[0], c[3], c[4]]),
        dot(p, [c[3], c[1], c[5]]),
        dot(p, [c[4], c[5], c[2]]),
    ]
}

/// Writes into `q` the quadric of the triangle `p` with weighed attributes `s` (each `weights[i]`
/// times its float, read in single precision); a triangle under 1e-12 of area writes zeros.
pub(crate) fn triangle(q: &mut [f64], p: [V3; 3], s: [&[f32]; 3], weights: &[f32]) {
    let m = weights.len();
    q.fill(0.0);
    let (p01, p02) = (sub(p[1], p[0]), sub(p[2], p[0]));
    let mut n = cross(p02, p01);
    q[NV..NV + 3].copy_from_slice(&n);
    q[DV] = -dot(n, p[0]);
    let length = dot(n, n).sqrt();
    let area = 0.5 * length;
    if not_at_least(area, 1e-12) {
        q[NV..NV + 3].fill(0.0);
        q[DV] = 0.0;
        return;
    }
    n = divide(n, length);
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
pub(crate) fn rebase(q: &mut [f64], point: V3, values: &[f32], weights: &[f32]) {
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
pub(crate) fn add_about(into: &mut [f64], q: &[f64], point: V3, values: &[f32], weights: &[f32]) {
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
pub(crate) fn evaluate(q: &[f64], p: V3, values: &[f32], weights: &[f32]) -> f32 {
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
pub(crate) fn solve_and_evaluate(q: &[f64], p: V3, values: &mut [f32], weights: &[f32]) -> f32 {
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

pub(super) fn clean(q: f64) -> f32 {
    if q < 0.0 || !q.is_finite() {
        0.0
    } else {
        q as f32
    }
}
