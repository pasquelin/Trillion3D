//! Whether a projected ring swings round once, read in linear time: a ring whose corners all
//! turn the same way, strictly, is convex only then — a star turns the same way at every corner
//! but swings round twice, and crosses itself (`ears`).

/// Does the edge direction swing round exactly once? Each half-turn crosses the vertical, so
/// the sign of the horizontal step changes twice per full turn, around the ring included. A
/// vertical step is skipped: its two neighbours, strictly turning, already sit on either side.
pub(super) fn swings_once(flat: &[[f64; 2]]) -> bool {
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
