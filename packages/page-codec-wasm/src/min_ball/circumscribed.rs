//! The smallest ball through a support of 2, 3 or 4 points — the diameter, the circumscribed
//! circle or sphere — the step of `min_ball`, as `through` is the ball of balls' one.
use super::{Ball, Held};
use trillion3d_math::vec3::cross;
use trillion3d_math::vecn::{add, dot, length, scale, sub};

/// The ball of which `a` and `b` are a diameter.
pub(super) fn diameter(a: [f64; 3], b: [f64; 3]) -> Ball {
    let centre = scale(add(a, b), 0.5);
    (centre, length(sub(a, centre)))
}

/// The smallest of `balls` that holds every point of `p`: the smallest ball of degenerate points
/// is one of their subsets' (a diameter or a circumscribed circle) that holds them all. The widest
/// holds them whatever the rounding, so it stands in when none does.
fn smallest_holding(balls: &[Ball], p: &[[f64; 3]]) -> Ball {
    let holding = |ball: &&Ball| p.iter().all(|&q| Held::new(**ball).contains(q));
    let by_radius = |x: &&Ball, y: &&Ball| x.1.total_cmp(&y.1);
    (balls.iter().filter(holding).min_by(by_radius))
        .or_else(|| balls.iter().max_by(by_radius))
        .copied()
        .expect("candidates")
}

/// Relative measure under which 3 points are colinear or 4 coplanar: the area or volume they span
/// against the product of their edges' lengths. The coordinates are float32 positions, so a cloud
/// far from the origin holds exactly degenerate subsets, and nearly degenerate ones whose
/// circumscribed ball the rounding throws far away.
const DEGENERATE: f64 = 1e-12;

/// The smallest ball through the 3 or 4 points `p` (circumscribed), or, when they are
/// degenerate (coincident, colinear or coplanar), the smallest ball of a subset holding them all.
pub(super) fn circumscribed(p: &[[f64; 3]]) -> Ball {
    match p.len() {
        3 => {
            let (ab, ac) = (sub(p[1], p[0]), sub(p[2], p[0]));
            let n = cross(ab, ac);
            let d = 2.0 * dot(n, n);
            if d <= 2.0 * DEGENERATE * dot(ab, ab) * dot(ac, ac) {
                let pairs = [
                    diameter(p[0], p[1]),
                    diameter(p[0], p[2]),
                    diameter(p[1], p[2]),
                ];
                return smallest_holding(&pairs, p);
            }
            let (t, u) = (cross(n, ab), cross(ac, n));
            let k = [0, 1, 2].map(|i| (dot(ac, ac) * t[i] + dot(ab, ab) * u[i]) / d);
            (add(p[0], k), length(k))
        }
        _ => {
            let (u, v, w) = (sub(p[1], p[0]), sub(p[2], p[0]), sub(p[3], p[0]));
            let det = 2.0 * dot(u, cross(v, w));
            if det.abs() <= 2.0 * DEGENERATE * length(u) * length(v) * length(w) {
                let pair = |a: usize, b: usize| diameter(p[a], p[b]);
                let candidates = [
                    pair(0, 1),
                    pair(0, 2),
                    pair(0, 3),
                    pair(1, 2),
                    pair(1, 3),
                    pair(2, 3),
                    circumscribed(&p[..3]),
                    circumscribed(&[p[0], p[1], p[3]]),
                    circumscribed(&[p[0], p[2], p[3]]),
                    circumscribed(&p[1..]),
                ];
                return smallest_holding(&candidates, p);
            }
            let (vw, wu, uv) = (cross(v, w), cross(w, u), cross(u, v));
            let (uu, vv, ww) = (dot(u, u), dot(v, v), dot(w, w));
            let k = [0, 1, 2].map(|i| (uu * vw[i] + vv * wu[i] + ww * uv[i]) / det);
            (add(p[0], k), length(k))
        }
    }
}
