//! The order the points enter the triangulation: a biased randomized insertion order, rounds of
//! growing size each read along a z-order curve, so consecutive points lie close together (the
//! walk to each one stays short) while the rounds keep the order random enough to avoid the worst
//! cases.
//!
//! 1. The extent of all the points (`tree::Rect::grow`, NaN coordinates passed over).
//! 2. The order starts as the identity; the number of rounds is the truncated product of the
//!    count's natural logarithm and `log₂ e` — one short of `log₂` itself for counts such as 8, 64
//!    or 128, whose product falls just below the integer.
//! 3. From the last round down to the second, the points left are drawn in turn from a fixed
//!    random stream (`Draws`, seeded with zero for every triangulation): a draw under one half
//!    swaps the point to the end of the range still undecided, which then shrinks, and the point
//!    swapped in is drawn next; the range left is the earlier rounds'.
//! 4. Each non-empty round is distributed to a quadtree over the extent of all the points, in the
//!    round's order, and read back along its z-order curve (`tree`), every odd round's children in
//!    reverse.
mod tree;

use std::f64::consts::LOG2_E;
use tree::{QuadTree, Rect};

/// The random stream deciding the rounds: a linear congruential generator on 32 bits, each draw
/// the high 23 bits of the new state as a single-precision fraction in `[0, 1)`.
struct Draws {
    state: u32,
}

impl Draws {
    /// The next fraction: the state stepped, its top 23 bits set under the exponent of one, one
    /// taken off.
    fn next_fraction(&mut self) -> f32 {
        self.state = self
            .state
            .wrapping_mul(196_314_165)
            .wrapping_add(907_633_515);
        f32::from_bits(0x3F80_0000 | (self.state >> 9)) - 1.0
    }
}

/// The insertion order of the points at `positions` (module doc), at least three of them.
pub(super) fn insertion_order(positions: &[[f64; 2]]) -> Vec<i32> {
    let mut extent = Rect::nothing();
    for &position in positions {
        extent.grow(position);
    }
    let count = positions.len();
    let mut sequence: Vec<i32> = (0..count as i32).collect();
    let rounds = ((count as f64).ln() * LOG2_E) as usize;
    let mut ends = vec![0; rounds];
    let mut end = count;
    ends[rounds - 1] = end;
    let mut draws = Draws { state: 0 };
    for round in (1..rounds).rev() {
        let mut index = 0;
        while index < end {
            if draws.next_fraction() < 0.5 {
                end -= 1;
                sequence.swap(index, end);
            } else {
                index += 1;
            }
        }
        ends[round - 1] = end;
    }
    let mut start = 0;
    for (round, &end) in ends.iter().enumerate() {
        if end != start {
            let quadtree = QuadTree::build(positions, &sequence[start..end], extent);
            quadtree.write_curve(&mut sequence[start..end], round & 1 == 1);
        }
        start = end;
    }
    sequence
}
