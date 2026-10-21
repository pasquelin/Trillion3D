//! Whether two plane segments cross, as the overlap test of a chart's boundary asks it.
//!
//! The segments are `p0 p1` and `p3 p4`; each point of the first is `p0 + t·(p1 − p0)`, of the
//! second `p3 + s·(p4 − p3)`. The crossing is solved case by case, so that no division meets a
//! zero: a segment shorter than `ZERO` on both axes crosses nothing; a vertical or horizontal
//! second segment, then first one, is solved on that axis; parallel segments (their unit
//! directions' cross product under half of `ZERO`) cross only when they overlap on one line, at
//! the overlap's first point; any other pair is solved by Cramer's rule, `s` read on the second
//! segment's longer axis. The segments cross when both `t` and `s` fall in `[0, 1]` widened by
//! `ZERO²`.
use super::{near_zero, root, ZERO};

/// Where two segments cross, `None` when they do not.
pub(crate) fn segments_cross(
    p0: [f32; 2],
    p1: [f32; 2],
    p3: [f32; 2],
    p4: [f32; 2],
) -> Option<[f32; 2]> {
    let (point, t, s) = solve(p0, p1, p3, p4)?;
    let slack = ZERO * ZERO;
    let inside = |v: f32| v > -slack && v < slack + 1.0;
    (inside(t) && inside(s)).then_some(point)
}

/// The first point both `[a0, a1]` and `[a3, a4]` hold, the ends in either order; `None` when
/// they are apart.
fn overlap_start(mut a0: f32, mut a1: f32, mut a3: f32, mut a4: f32) -> Option<f32> {
    if a0 > a1 {
        std::mem::swap(&mut a0, &mut a1);
    }
    if a3 > a4 {
        std::mem::swap(&mut a3, &mut a4);
    }
    if a1 < a3 || a0 > a4 {
        return None;
    }
    Some(if a0 >= a3 { a0 } else { a3 })
}

/// The crossing point and its parameters `t` on the first segment and `s` on the second, `None`
/// where the library leaves both out of range.
fn solve(p0: [f32; 2], p1: [f32; 2], p3: [f32; 2], p4: [f32; 2]) -> Option<([f32; 2], f32, f32)> {
    let [x0, y0] = p0;
    let [x1, y1] = p1;
    let [x3, y3] = p3;
    let [x4, y4] = p4;
    if (near_zero(x1 - x0) && near_zero(y1 - y0)) || (near_zero(x4 - x3) && near_zero(y4 - y3)) {
        return None;
    }
    if near_zero(x3 - x4) {
        if near_zero(x0 - x1) {
            if !near_zero(x3 - x0) {
                return None;
            }
            let y = overlap_start(y0, y1, y3, y4)?;
            return Some(([x0, y], (y - y0) / (y1 - y0), (y - y3) / (y4 - y3)));
        }
        let t = (x3 - x0) / (x1 - x0);
        let y = y0 + t * (y1 - y0);
        return Some(([x3, y], t, (y - y3) / (y4 - y3)));
    }
    if near_zero(y3 - y4) {
        if near_zero(y0 - y1) {
            if !near_zero(y3 - y0) {
                return None;
            }
            let x = overlap_start(x0, x1, x3, x4)?;
            return Some(([x, y0], (x - x0) / (x1 - x0), (x - x3) / (x4 - x3)));
        }
        let t = (y3 - y0) / (y1 - y0);
        let x = x0 + t * (x1 - x0);
        return Some(([x, y3], t, (x - x3) / (x4 - x3)));
    }
    if near_zero(x0 - x1) {
        let s = (x0 - x3) / (x4 - x3);
        let y = y3 + s * (y4 - y3);
        return Some(([x0, y], (y - y0) / (y1 - y0), s));
    }
    if near_zero(y0 - y1) {
        let s = (y0 - y3) / (y4 - y3);
        let x = x3 + s * (x4 - x3);
        return Some(([x, y0], (x - x0) / (x1 - x0), s));
    }
    let mut v1 = [x1 - x0, y1 - y0];
    let length = root(v1[0] * v1[0] + v1[1] * v1[1]);
    if near_zero(length) {
        return None;
    }
    v1 = [v1[0] / length, v1[1] / length];
    let mut v2 = [x4 - x3, y4 - y3];
    let length = root(v2[0] * v2[0] + v2[1] * v2[1]);
    v2 = [v2[0] / length, v2[1] / length];
    if (((v1[0] * v2[1] - v1[1] * v2[0]).abs()) as f64) < ZERO as f64 / 2.0 {
        let ratio = [(x3 - x0) / (x1 - x0), (y3 - y0) / (y1 - y0)];
        if !near_zero(ratio[0] - ratio[1]) {
            return None;
        }
        let x = overlap_start(x0, x1, x3, x4)?;
        let t = (x - x0) / (x1 - x0);
        return Some(([x, y0 + t * (y1 - y0)], t, (x - x3) / (x4 - x3)));
    }
    let t = ((x3 - x0) * (y4 - y3) - (y3 - y0) * (x4 - x3))
        / ((x1 - x0) * (y4 - y3) - (y1 - y0) * (x4 - x3));
    let point = [x0 + t * (x1 - x0), y0 + t * (y1 - y0)];
    let s = if (x4 - x3).abs() > (y4 - y3).abs() {
        (point[0] - x3) / (x4 - x3)
    } else {
        (point[1] - y3) / (y4 - y3)
    };
    Some((point, t, s))
}
