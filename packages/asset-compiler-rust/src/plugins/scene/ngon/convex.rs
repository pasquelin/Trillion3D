//! Convexity of a projected ring, read in linear time.
//!
//! A ring whose corners all turn the same way, strictly, and whose edges swing round exactly
//! once is a simple, strictly convex polygon: no corner falls in the triangle of three others,
//! so every triangle of the fan from the first corner is an ear, and the ear cut would take
//! them one by one along that very fan. The fan is then written directly, in a pass over the
//! corners, where the ear cut scanned the living corners for each triangle it cut.
//!
//! Both conditions are needed. A collinear or duplicated corner turns by zero: the ear cut
//! treats its empty triangle as a special case and may leave the fan, so such a ring stays on
//! the ear path — the output of a scene does not move by one index. A star polygon turns the
//! same way at every corner but swings round twice: it crosses itself and has no fan.
use super::plane::side;

/// True when the fan from the first corner is exactly the ear cut of `flat`, walked in the
/// sense `turn` (`1.0` direct, `-1.0` indirect).
pub(super) fn fan_is_exact(flat: &[[f64; 2]], turn: f64) -> bool {
    let sides = flat.len();
    let turns_one_way = (0..sides).all(|rank| {
        let (before, after) = ((rank + sides - 1) % sides, (rank + 1) % sides);
        turn * side(flat[before], flat[rank], flat[after]) > 0.0
    });
    turns_one_way && swings_once(flat)
}

/// Does the edge direction swing round exactly once? Each half-turn crosses the vertical, so
/// the sign of the horizontal step changes twice per full turn, around the ring included. A
/// vertical step is skipped: its two neighbours, strictly turning, already sit on either side.
fn swings_once(flat: &[[f64; 2]]) -> bool {
    let sides = flat.len();
    let (mut first, mut last, mut changes) = (None, None, 0);
    for rank in 0..sides {
        let step = flat[(rank + 1) % sides][0] - flat[rank][0];
        if step == 0.0 {
            continue;
        }
        let sign = step > 0.0;
        changes += usize::from(last.is_some_and(|last| last != sign));
        first.get_or_insert(sign);
        last = Some(sign);
    }
    changes + usize::from(first != last) == 2
}
