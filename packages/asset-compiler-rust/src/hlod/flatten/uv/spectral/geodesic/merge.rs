//! The window of least distance taken from the heap, joined first with an adjacent window of its
//! edge when one window can stand for both.
//!
//! Two windows are adjacent when one ends where the other starts. The joined window spans both;
//! its pseudo source is placed so its distance matches both windows at the joined window's two
//! ends: on the hyperbola branch those two conditions leave, at the middle of the stretch of it
//! whose distance stays positive and between the two ends' distances, and on the side of both
//! windows' rays that keeps the joined rays between them (below the crossing of those rays when
//! they cross above the edge). The join is kept when the error it adds — the largest gap, over
//! both windows' ends and the points where the new and old distance fronts are tangent, between
//! the joined distance and the old one — keeps the accumulated error under 1% of that distance and
//! the gap itself under 0.1%. The joined window replaces the popped one in the heap and the next
//! window is taken; a window that joins nothing is returned.
use super::plane::{line_crossing, root_min0};
use super::{Link, Window, Windows};
use crate::hlod::flatten::uv::spectral::mesh::NONE;
use trillion3d_math::scalar::not_above;
use trillion3d_math::vector::vecn::distance2;

/// The pseudo source and distance of the window joining `left` (first) and `right` (second), and
/// the error it adds; `None` when they cannot join.
fn join(left: &Window, right: &Window) -> Option<([f64; 2], f64, f64, f64)> {
    let (b0, b1) = (left.b0, right.b1);
    let d1 = right.pseudo_distance + root_min0(distance2([b1, 0.0], right.src));
    let d0 = left.pseudo_distance + root_min0(distance2([b0, 0.0], left.src));
    if (d1 - d0).abs() < f64::EPSILON {
        return None;
    }
    let alpha = (b1 - b0) / (d1 - d0);
    let beta = (b0 * b0 - b1 * b1 - d0 * d0 + d1 * d1) / (2.0 * (d1 - d0));
    let a = alpha * alpha - 1.0;
    let b = 2.0 * alpha * (beta - d0) + 2.0 * b0;
    let c = (d0 - beta) * (d0 - beta) - b0 * b0;
    let (crossing, _) = line_crossing(left.src, [left.b0, 0.0], right.src, [right.b1, 0.0]);
    let x1 = -beta / alpha;
    let mut x2 = (d0 - beta) / alpha;
    let x3 = (d1 - beta) / alpha;
    if alpha < 0.0 {
        if x3 > x2 {
            x2 = x3;
        }
        if x2 > x1 {
            return None;
        }
    } else {
        if x3 < x2 {
            x2 = x3;
        }
        if x1 > x2 {
            return None;
        }
    }
    let x = (x1 + x2) * 0.5;
    let y2 = a * (x * x) + b * x + c;
    if y2 < 0.0 {
        return None;
    }
    let spie = [x, y2.sqrt()];
    let p0 = [left.src[0] - left.b0, left.src[1]];
    let q0 = [spie[0] - left.b0, spie[1]];
    let p1 = [right.src[0] - right.b1, right.src[1]];
    let q1 = [spie[0] - right.b1, spie[1]];
    let z0 = q0[0] * p0[1] - q0[1] * p0[0];
    let z1 = q1[0] * p1[1] - q1[1] * p1[0];
    let below = !(crossing[0] < f32::MAX as f64 && crossing[1] > 0.0 && spie[1] > crossing[1]);
    let sign = |z: f64| if z >= 0.0 { 1 } else { -1 };
    if !((sign(z0) != sign(z1) || z0 == 0.0 || z1 == 0.0) && below) {
        return None;
    }
    let sigma = alpha * spie[0] + beta;
    let mut largest = 0.0;
    let mut dp = f32::MAX as f64;
    for case in 0..6 {
        let Some((x, old)) = probe(case, left, right, spie) else {
            continue;
        };
        let gap = (sigma + root_min0(distance2(spie, [x, 0.0])) - old).abs();
        if gap > largest {
            largest = gap;
            dp = old;
        }
    }
    Some((spie, sigma, largest, dp))
}

/// The point on the edge and the old distance there of probe `case`: the four window ends, then
/// where the new front is tangent to the left window's front, then the right's.
fn probe(case: usize, left: &Window, right: &Window, spie: [f64; 2]) -> Option<(f64, f64)> {
    let end = |w: &Window, start: bool| {
        let (x, d) = if start { (w.b0, w.d0) } else { (w.b1, w.d1) };
        Some((x, w.pseudo_distance + d))
    };
    match case {
        0 => end(left, true),
        1 => end(left, false),
        2 => end(right, true),
        3 => end(right, false),
        _ => {
            let w = if case == 4 { left } else { right };
            let s2 = w.src[1] * w.src[1];
            let p2 = spie[1] * spie[1];
            let a0 = p2 - s2;
            let b0 = 2.0 * (spie[0] * s2 - w.src[0] * p2);
            let c0 = w.src[0] * w.src[0] * p2 - spie[0] * spie[0] * s2;
            let outside = |x: f64| x < w.b0 || x > w.b1;
            let x = if a0 > f32::EPSILON as f64 || a0 < -(f32::EPSILON as f64) {
                let disc = b0 * b0 - 4.0 * a0 * c0;
                if not_above(disc, 0.0) {
                    return None;
                }
                let mut x = (-b0 + root_min0(disc)) / (2.0 * a0);
                if outside(x) {
                    x = (-b0 - root_min0(disc)) / (2.0 * a0);
                    if outside(x) {
                        return None;
                    }
                }
                x
            } else {
                if b0 == 0.0 {
                    return None;
                }
                let x = -c0 / b0;
                if outside(x) {
                    return None;
                }
                x
            };
            Some((x, w.pseudo_distance + root_min0(distance2(w.src, [x, 0.0]))))
        }
    }
}

impl Windows {
    /// The next window to unfold.
    pub(super) fn pop_window(&mut self) -> Window {
        'next: loop {
            let id = self.heap.pop().expect("a held window");
            let popped = self.held[id as usize];
            let edge = popped.edge as usize;
            let mut own = None;
            for i in 0..self.edges[edge].windows.len() {
                let listed = &self.edges[edge].windows[i];
                if listed.link == Link::Out {
                    continue;
                }
                if listed.link == Link::Held(id) {
                    own = Some(i);
                    continue;
                }
                let (mut left, mut right) = (popped, listed.window);
                if !(left.b0 == right.b1 || left.b1 == right.b0) {
                    continue;
                }
                if left.b0 == right.b1 {
                    std::mem::swap(&mut left, &mut right);
                }
                let Some((spie, sigma, largest, dp)) = join(&left, &right) else {
                    continue;
                };
                let ksi = (if right.ksi < left.ksi {
                    left.ksi
                } else {
                    right.ksi
                }) + largest;
                if !(ksi / dp < 0.01 && largest / dp < 0.01 * 0.1) {
                    continue;
                }
                let mut own = own.or_else(|| {
                    (i + 1..self.edges[edge].windows.len())
                        .find(|&t| self.edges[edge].windows[t].link == Link::Held(id))
                });
                if let Link::Held(adjacent) = self.edges[edge].windows[i].link {
                    self.release(adjacent);
                }
                self.edges[edge].windows.remove(i);
                if let Some(o) = own.as_mut() {
                    if *o > i {
                        *o -= 1;
                    }
                }
                let slot = own.expect("the popped window on its edge");
                let joined = &mut self.edges[edge].windows[slot].window;
                joined.b0 = left.b0;
                joined.b1 = right.b1;
                joined.pseudo_distance = sigma;
                joined.src = spie;
                joined.d0 = root_min0(distance2([left.b0, 0.0], spie));
                joined.d1 = root_min0(distance2([right.b1, 0.0], spie));
                joined.ksi = ksi;
                joined.pseudo = NONE;
                let joined = *joined;
                let new_id = self.hold(joined);
                self.edges[edge].windows[slot].link = Link::Held(new_id);
                self.free.push(id);
                continue 'next;
            }
            let slot = own.or_else(|| {
                self.edges[edge]
                    .windows
                    .iter()
                    .position(|l| l.link == Link::Held(id))
            });
            if let Some(slot) = slot {
                self.edges[edge].windows[slot].link = Link::Out;
            }
            self.free.push(id);
            return popped;
        }
    }
}
