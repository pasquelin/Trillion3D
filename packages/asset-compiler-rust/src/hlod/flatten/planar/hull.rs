//! The convex hull of a point set in the plane, by divide and conquer (after the hull of David
//! Eberly's Geometric Tools), in double or single precision — the same steps, every comparison and
//! turn in the points' own precision (`Coordinate`):
//!
//! 1. the points' ranks sorted by x, then y (`sort::unstable_sort`, `before`), and each run of equal
//!    points — both coordinates `==` — kept by its first rank;
//! 2. fewer than three distinct points, or every one on the line through the first two (`orient`
//!    exactly zero), have no hull;
//! 3. the sorted ranks hulled by halves (`halves`): a range of one point is its own hull; a longer
//!    one is split at `(first + last) / 2`, the lower half and the upper half hulled, and the two
//!    counterclockwise hulls joined (`join_hulls`) over the range's front:
//!    - the left hull's greatest point (x then y, the first of equals) and the right hull's least
//!      start both tangents;
//!    - the lower tangent (`bridge`) walks its left end back while the right end lies right of
//!      the left hull's edge into it or on that edge's line ahead of it, and its right end forward
//!      while the left end lies right of the right hull's edge out of it or on that edge's line
//!      behind it, one step at a time, until neither moves (at most as many steps as the two hulls
//!      have corners); the upper tangent walks the same way, the hulls' roles exchanged;
//!    - the joined hull runs from the upper tangent's left end forward around the left hull to the
//!      lower tangent's left end, then from the lower tangent's right end forward around the right
//!      hull to the upper tangent's right end.
//!
//! A point on the line of a hull edge is walked past (step 3), so no three consecutive corners of
//! a hull lie on one line.
use super::predicates::{orient, orient_single};
use crate::hlod::flatten::sort::unstable_sort;
use trillion3d_math::scalar::real::Real;

/// A coordinate the hull is found in, `f64` or `f32`: compared as IEEE floats — every comparison
/// with NaN fails — and turned by the exact orientation of its own precision.
trait Coordinate: Real + PartialOrd {
    /// Twice the signed area of `a`, `b`, `c`, its sign exact (`predicates::orient` in double
    /// precision, `orient_single` in single): positive when they turn counterclockwise.
    fn turn(a: [Self; 2], b: [Self; 2], c: [Self; 2]) -> Self;
}

impl Coordinate for f64 {
    fn turn(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
        orient(a, b, c)
    }
}

impl Coordinate for f32 {
    fn turn(a: [f32; 2], b: [f32; 2], c: [f32; 2]) -> f32 {
        orient_single(a, b, c)
    }
}

/// Where a point lies against the directed line through a hull edge's two ends: left or right of
/// it, or on it — before its start, between its ends, or ahead of its end.
enum Side {
    Left,
    Right,
    Behind,
    Between,
    Ahead,
}

/// The convex hull of `points` (module doc): ranks into `points`, in the order the joins leave
/// them — counterclockwise (each corner turns left, `orient` positive, from the one before it to
/// the one after), starting at the corner of the lower half's hull that the upper common tangent
/// of the two halves' hulls touches, the halves being the first `⌈m / 2⌉` of the `m` distinct
/// points in x-then-y order and the rest. Of equal points, the rank kept is the first of their run
/// in the sorted order. `None` when fewer than three distinct points are given or all of them lie
/// on one line.
pub(crate) fn convex_hull(points: &[[f64; 2]]) -> Option<Vec<usize>> {
    hull(points)
}

/// `convex_hull` in single precision: every comparison a single-precision one, every turn
/// `orient_single`; the corners in the same order, as single-precision arithmetic leaves them.
pub(crate) fn convex_hull_single(points: &[[f32; 2]]) -> Option<Vec<usize>> {
    hull(points)
}

/// Whether `p` comes before `q`: a lesser x, or an equal x and a lesser y.
fn before<T: Coordinate>(p: [T; 2], q: [T; 2]) -> bool {
    p[0] < q[0] || (p[0] == q[0] && p[1] < q[1])
}

/// The hull of `points` in their precision (`convex_hull`).
fn hull<T: Coordinate>(points: &[[T; 2]]) -> Option<Vec<usize>> {
    let mut ranks: Vec<usize> = (0..points.len()).collect();
    unstable_sort(&mut ranks, |&a, &b| before(points[a], points[b]));
    ranks.dedup_by(|later, kept| points[*later] == points[*kept]);
    if ranks.len() < 3 {
        return None;
    }
    let (first, second) = (points[ranks[0]], points[ranks[1]]);
    if (ranks[2..].iter()).all(|&r| T::turn(first, second, points[r]) == T::ZERO) {
        return None;
    }
    let mut scratch = vec![0; ranks.len()];
    let last = ranks.len() - 1;
    let (_, end) = halves(points, &mut ranks, &mut scratch, (0, last));
    ranks.truncate(end + 1);
    Some(ranks)
}

/// The hull of the sorted ranks `ranks[first..=last]`, counterclockwise, written over the front of
/// that range (step 3): the range it then holds, from `first`. `scratch` holds each join's corners
/// before they are written back.
fn halves<T: Coordinate>(
    points: &[[T; 2]],
    ranks: &mut [usize],
    scratch: &mut [usize],
    (first, last): (usize, usize),
) -> (usize, usize) {
    if last <= first {
        return (first, last);
    }
    let middle = (first + last) / 2;
    let left = halves(points, ranks, scratch, (first, middle));
    let right = halves(points, ranks, scratch, (middle + 1, last));
    join_hulls(points, ranks, scratch, left, right)
}

/// The hulls held by `ranks[left.0..=left.1]` and `ranks[right.0..=right.1]` — every point of the
/// first before every point of the second — joined into one, written from `left.0` (step 3): the
/// range it then holds.
fn join_hulls<T: Coordinate>(
    points: &[[T; 2]],
    ranks: &mut [usize],
    scratch: &mut [usize],
    (j0, j1): (usize, usize),
    (j2, j3): (usize, usize),
) -> (usize, usize) {
    let at = |i: usize| points[ranks[i]];
    let mut most = j0;
    for i in j0 + 1..=j1 {
        if before(at(most), at(i)) {
            most = i;
        }
    }
    let mut least = j2;
    for i in j2 + 1..=j3 {
        if before(at(i), at(least)) {
            least = i;
        }
    }
    let (lower_left, lower_right) = bridge(&at, (j0, j1), (j2, j3), (most, least));
    let (upper_right, upper_left) = bridge(&at, (j2, j3), (j0, j1), (least, most));
    let mut count = 0;
    let mut i = upper_left;
    for _ in 0..j1 - j0 + 1 {
        scratch[count] = ranks[i];
        count += 1;
        if i == lower_left {
            break;
        }
        i = if i < j1 { i + 1 } else { j0 };
    }
    i = lower_right;
    for _ in 0..j3 - j2 + 1 {
        scratch[count] = ranks[i];
        count += 1;
        if i == upper_right {
            break;
        }
        i = if i < j3 { i + 1 } else { j2 };
    }
    ranks[j0..j0 + count].copy_from_slice(&scratch[..count]);
    (j0, j0 + count - 1)
}

/// The tangent from the hull held at `(j0, j1)` to the one at `(j2, j3)`, walked from their
/// corners `i0` and `i1` (step 3): the first end steps back around its hull while the second end
/// lies right of the edge into it or ahead on its line, the second end steps forward around its
/// hull while the first end lies right of the edge out of it or behind on its line, one step a
/// turn, for at most as many turns as the two hulls have corners. Its two ends, in that order.
fn bridge<T: Coordinate>(
    at: &impl Fn(usize) -> [T; 2],
    (j0, j1): (usize, usize),
    (j2, j3): (usize, usize),
    (mut i0, mut i1): (usize, usize),
) -> (usize, usize) {
    let (size0, size1) = (j1 - j0 + 1, j3 - j2 + 1);
    for _ in 0..size0 + size1 {
        let (l1, r0) = (at(i0), at(i1));
        if size0 > 1 {
            let back = if i0 > j0 { i0 - 1 } else { j1 };
            if matches!(side(r0, at(back), l1), Side::Right | Side::Ahead) {
                i0 = back;
                continue;
            }
        }
        if size1 > 1 {
            let on = if i1 < j3 { i1 + 1 } else { j2 };
            if matches!(side(l1, r0, at(on)), Side::Right | Side::Behind) {
                i1 = on;
                continue;
            }
        }
        break;
    }
    (i0, i1)
}

/// Where `p` lies against the line from `l0` to `l1` (`Side`), the three distinct: by the exact
/// turn of `p`, `l0`, `l1`; on the line, by the first coordinate — the second when `p` and `l0`
/// share the first —: between the ends when `p` passes exactly one of them, else ahead when it
/// lies past `l0` on the side `l1` does, behind otherwise. A NaN turn reads as on the line.
fn side<T: Coordinate>(p: [T; 2], l0: [T; 2], l1: [T; 2]) -> Side {
    let turn = T::turn(p, l0, l1);
    if turn > T::ZERO {
        return Side::Left;
    }
    if turn < T::ZERO {
        return Side::Right;
    }
    let axis = usize::from(p[0] == l0[0]);
    let (past_start, past_end) = (p[axis] > l0[axis], p[axis] > l1[axis]);
    if past_start != past_end {
        Side::Between
    } else if (l1[axis] > l0[axis]) == past_start {
        Side::Ahead
    } else {
        Side::Behind
    }
}
