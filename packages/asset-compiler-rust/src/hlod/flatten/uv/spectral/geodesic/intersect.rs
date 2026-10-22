//! Two windows of one edge made not to overlap.
//!
//! The new window is first measured from the existing window's mark end. Windows that do not
//! overlap are left. A new window nearly equal to the existing one (pseudo sources, ends and
//! pseudo distances within `f32::EPSILON`) is dropped. A window strictly inside the other shrinks
//! the outer one to start where it starts, the outer one's uncovered start becoming a piece of
//! its own when longer than 10⁻⁵. An overlap of at most 10⁻⁵ is taken off the new window; a larger
//! one is given to the window nearer its pseudo source at the overlap's middle, the other window
//! losing it, or vanishing when that leaves it nothing.
use super::plane::distance;
use super::propagate::EPS;
use super::{Window, Windows};
use crate::hlod::flatten::uv::extremes::{greater, lesser};

/// An overlap at most this long is a rounding error.
const TINY_OVERLAP: f64 = 0.00001;

/// What testing two windows changed.
#[derive(Default)]
pub(super) struct Outcome {
    pub existing_changed: bool,
    pub existing_gone: bool,
    pub fresh_gone: bool,
    /// The uncovered start of the existing window, of no width when there is none.
    pub existing_piece: Window,
    /// The uncovered start of the new window, of no width when there is none.
    pub fresh_piece: Window,
}

/// The start of `w` up to `b1` as a window of its own.
fn piece(w: &Window, b1: f64) -> Window {
    Window {
        b1,
        d1: distance([b1, 0.0], w.src),
        ..*w
    }
}

impl Windows {
    /// `existing` and `fresh`, on the same edge, made not to overlap.
    pub(super) fn intersect(&self, existing: &mut Window, fresh: &mut Window) -> Outcome {
        let mut out = Outcome::default();
        if fresh.b1 <= fresh.b0 {
            return out;
        }
        let length = self.edges[fresh.edge as usize].length;
        if existing.mark != fresh.mark {
            fresh.mark = existing.mark;
            std::mem::swap(&mut fresh.d0, &mut fresh.d1);
            std::mem::swap(&mut fresh.b0, &mut fresh.b1);
            fresh.b0 = greater(length - fresh.b0, 0.0);
            if fresh.b0 < EPS {
                fresh.b0 = 0.0;
            }
            fresh.b1 = length - fresh.b1;
            fresh.src[0] = length - fresh.src[0];
        }
        let a = lesser(lesser(lesser(existing.b0, existing.b1), fresh.b0), fresh.b1);
        let b = greater(
            greater(greater(existing.b0, existing.b1), fresh.b0),
            fresh.b1,
        );
        let overlap = (existing.b1 - existing.b0 + fresh.b1 - fresh.b0) - (b - a);
        if overlap <= 0.0 {
            return out;
        }
        let (es, ns) = (existing.src, fresh.src);
        let near = |x: f64, y: f64| (x - y).abs() < EPS;
        let src_gap = (es[0] - ns[0]) * (es[0] - ns[0]) + (es[1] - ns[1]) * (es[1] - ns[1]);
        if src_gap < EPS
            && near(existing.b0, fresh.b0)
            && near(existing.b1, fresh.b1)
            && near(existing.pseudo_distance, fresh.pseudo_distance)
        {
            out.fresh_gone = true;
            return out;
        }
        let at = |x: f64, src: [f64; 2]| distance([x, 0.0], src);
        if fresh.b0 > existing.b0 && fresh.b1 < existing.b1 {
            if fresh.b0 - existing.b0 > TINY_OVERLAP {
                out.existing_piece = piece(existing, fresh.b0);
            }
            existing.b0 = fresh.b0;
            existing.d0 = at(existing.b0, es);
            out.existing_changed = true;
        }
        if existing.b0 > fresh.b0 && existing.b1 < fresh.b1 {
            if existing.b0 - fresh.b0 > TINY_OVERLAP {
                out.fresh_piece = piece(fresh, existing.b0);
            }
            fresh.b0 = existing.b0;
            fresh.d0 = at(fresh.b0, ns);
        }
        let (start, from_fresh) = if fresh.b0 > existing.b0 && fresh.b0 < existing.b1 {
            (fresh.b0, true)
        } else if (existing.b0 > fresh.b0 && existing.b0 < fresh.b1) || fresh.b1 < existing.b1 {
            (existing.b0, false)
        } else {
            (fresh.b0, true)
        };
        if overlap > 0.0 && overlap <= TINY_OVERLAP {
            if from_fresh {
                fresh.b0 += overlap;
                fresh.d0 = at(fresh.b0, ns);
            } else {
                fresh.b1 -= overlap;
                fresh.d1 = at(fresh.b1, ns);
            }
            out.fresh_gone = fresh.b0 >= fresh.b1;
            return out;
        }
        let middle = start + overlap / 2.0;
        let same = fresh.b0 == existing.b0 && fresh.b1 == existing.b1;
        if at(middle, ns) + fresh.pseudo_distance > at(middle, es) + existing.pseudo_distance {
            if same {
                out.fresh_gone = true;
                return out;
            }
            if !from_fresh {
                fresh.b1 -= overlap;
                if fresh.b1 <= fresh.b0 {
                    out.fresh_gone = true;
                    return out;
                }
                fresh.d1 = at(fresh.b1, ns);
            } else {
                fresh.b0 += overlap;
                if fresh.b0 >= fresh.b1 {
                    out.fresh_gone = true;
                    return out;
                }
                fresh.d0 = at(fresh.b0, ns);
            }
        } else {
            out.existing_changed = true;
            if same {
                out.existing_gone = true;
                return out;
            }
            if from_fresh {
                existing.b1 -= overlap;
                if existing.b1 <= existing.b0 {
                    out.existing_gone = true;
                } else {
                    existing.d1 = at(existing.b1, es);
                }
            } else {
                existing.b0 += overlap;
                if existing.b0 >= existing.b1 {
                    out.existing_gone = true;
                } else {
                    existing.d0 = at(existing.b0, es);
                }
            }
        }
        out
    }
}
