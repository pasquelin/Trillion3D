//! The smallest ball every given ball — one to four — touches from inside: the basis step of the
//! ball of balls (`ball_of_balls`), as `circumscribed` is the points' one.
//!
//! A ball `(c, R)` touches ball `j` from inside when `|c - c_j| = R - r_j`. With `c` in the affine
//! hull of the centres, `c = c_0 + Σ λ_m u_m` (`u_m = c_m - c_0`), subtracting equation 0 from
//! equation `j` leaves one linear equation per other ball, `Σ λ_m 2 u_m·u_j = |u_j|² - r_j² + r_0²
//! + 2R (r_j - r_0)`: `λ` is affine in `R`, and equation 0 then reads `|x_0 + R x_1|² = (R - r_0)²`,
//! a quadratic in `R`. Its least root no smaller than any radius is the ball; a degenerate set (a
//! singular system, no such root) has none — a smaller subset of it is then the support.
//!
//! `basis` is the pivot of the ball of balls: the smallest ball of at most five balls, exactly.
//! The smallest ball of a set has a support of at most four affinely independent balls, all
//! touching it, so its centre is that of `through` some subset; every other subset's centre needs
//! at least that radius to hold the set (`radius_for`). The least of those radii over the subsets
//! is therefore the smallest ball.
use trillion3d_math::vecn::{add, dot, length, scale, sub};

/// A ball as its centre and radius.
type Sphere = [f64; 4];

fn centre(s: &Sphere) -> [f64; 3] {
    [s[0], s[1], s[2]]
}

/// The smallest ball touching `balls` (one to four) from inside; `None` for a degenerate set.
fn through(balls: &[Sphere]) -> Option<Sphere> {
    match balls.len() {
        0 => None,
        1 => Some(balls[0]),
        2 => Some(pair(&balls[0], &balls[1])),
        _ => tangent(balls),
    }
}

/// The radius a ball centred on `c` needs to hold every ball of `balls`.
pub(super) fn radius_for(c: [f64; 3], balls: &[Sphere]) -> f64 {
    balls
        .iter()
        .map(|s| length(sub(centre(s), c)) + s[3])
        .fold(0.0, f64::max)
}

/// The smallest ball holding `set` (one to five balls) and its support: over every subset of at
/// most four, the centre `through` gives, the one needing the least radius to hold the set.
pub(super) fn basis(set: &[Sphere]) -> (Vec<Sphere>, Sphere) {
    let n = set.len();
    let mut best: Option<(Vec<Sphere>, Sphere)> = None;
    for mask in 1u32..(1 << n) {
        if mask.count_ones() > 4 {
            continue;
        }
        let subset: Vec<Sphere> = (0..n)
            .filter(|k| mask >> k & 1 == 1)
            .map(|k| set[k])
            .collect();
        let Some(ball) = through(&subset) else {
            continue;
        };
        let c = centre(&ball);
        let r = radius_for(c, set);
        if best.as_ref().is_none_or(|(_, b)| r < b[3]) {
            best = Some((subset, [c[0], c[1], c[2], r]));
        }
    }
    // A single ball is always a subset, so some centre always exists.
    best.unwrap_or_else(|| (vec![set[0]], set[0]))
}

/// The smallest ball holding `a` and `b`: the larger when it holds the other, otherwise the ball on
/// their axis that reaches both far sides.
fn pair(a: &Sphere, b: &Sphere) -> Sphere {
    let u = sub(centre(b), centre(a));
    let d = length(u);
    if d + b[3] <= a[3] {
        return *a;
    }
    if d + a[3] <= b[3] {
        return *b;
    }
    let r = (d + a[3] + b[3]) * 0.5;
    let c = add(centre(a), scale(u, (r - a[3]) / d));
    [c[0], c[1], c[2], r]
}

/// The ball touching three or four balls from inside, `None` when their set is degenerate.
fn tangent(balls: &[Sphere]) -> Option<Sphere> {
    let (o, r0, n) = (centre(&balls[0]), balls[0][3], balls.len() - 1);
    let u: Vec<[f64; 3]> = balls[1..].iter().map(|b| sub(centre(b), o)).collect();
    let mut m = [[0.0; 3]; 3];
    let (mut fixed, mut per_radius) = ([0.0; 3], [0.0; 3]);
    for j in 0..n {
        for k in 0..n {
            m[j][k] = 2.0 * dot(u[j], u[k]);
        }
        let rj = balls[j + 1][3];
        fixed[j] = dot(u[j], u[j]) - rj * rj + r0 * r0;
        per_radius[j] = 2.0 * (rj - r0);
    }
    let (alpha, beta) = (solve(m, fixed, n)?, solve(m, per_radius, n)?);
    let along = |w: [f64; 3]| (0..n).fold([0.0; 3], |x, j| add(x, scale(u[j], w[j])));
    let (x0, x1) = (along(alpha), along(beta));
    // |x0 + R x1|² = (R - r0)², as qa R² + qb R + qc = 0.
    let qa = dot(x1, x1) - 1.0;
    let qb = 2.0 * (dot(x0, x1) + r0);
    let qc = dot(x0, x0) - r0 * r0;
    let floor = balls.iter().map(|b| b[3]).fold(0.0, f64::max);
    let roots: Vec<f64> = if qa.abs() < 1e-12 {
        if qb == 0.0 {
            return None;
        }
        vec![-qc / qb]
    } else {
        let disc = qb * qb - 4.0 * qa * qc;
        if !(disc >= 0.0) {
            return None;
        }
        let s = disc.sqrt();
        vec![(-qb - s) / (2.0 * qa), (-qb + s) / (2.0 * qa)]
    };
    let r = roots
        .into_iter()
        .filter(|r| r.is_finite() && *r >= floor * (1.0 - 1e-12))
        .fold(f64::INFINITY, f64::min);
    if !r.is_finite() {
        return None;
    }
    let c = add(o, add(x0, scale(x1, r)));
    Some([c[0], c[1], c[2], r.max(floor)])
}

/// `x` with `m x = b` for the leading `n` × `n` block, by elimination with partial pivoting;
/// `None` when the block is singular against its own scale.
fn solve(mut m: [[f64; 3]; 3], mut b: [f64; 3], n: usize) -> Option<[f64; 3]> {
    let scale_of = (0..n)
        .flat_map(|j| (0..n).map(move |k| (j, k)))
        .fold(0.0f64, |s, (j, k)| s.max(m[j][k].abs()));
    if !(scale_of > 0.0) {
        return None;
    }
    for col in 0..n {
        let pivot = (col..n).max_by(|&x, &y| m[x][col].abs().total_cmp(&m[y][col].abs()))?;
        if m[pivot][col].abs() <= scale_of * 1e-12 {
            return None;
        }
        m.swap(col, pivot);
        b.swap(col, pivot);
        for row in col + 1..n {
            let f = m[row][col] / m[col][col];
            for k in col..n {
                m[row][k] -= f * m[col][k];
            }
            b[row] -= f * b[col];
        }
    }
    let mut x = [0.0; 3];
    for row in (0..n).rev() {
        let tail: f64 = (row + 1..n).map(|k| m[row][k] * x[k]).sum();
        x[row] = (b[row] - tail) / m[row][row];
    }
    Some(x)
}
