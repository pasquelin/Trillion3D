//! The random draws of the charts: the linear congruential generator of the C runtime the library
//! was built against, state times 214013 plus 2531011, wrapping, its draw the state's bits 16 to
//! 30. The library seeds it with 2 before each random walk of a vertex, so a chart's result never
//! depends on the charts before it; the packer draws on from wherever the partition left it.
//!
//! The state starts at 1, the runtime's state on a thread that never seeded it, at the start of
//! each partition: one mesh's charts never depend on another's.
use std::cell::Cell;

/// The largest draw.
pub(crate) const DRAW_MAX: i32 = 0x7fff;

/// The state before any seed.
pub(crate) const UNSEEDED: u32 = 1;

/// The generator restarted at `seed`.
pub(crate) fn seed(state: &Cell<u32>, seed: u32) {
    state.set(seed);
}

/// The next draw, in `0..=DRAW_MAX`.
pub(crate) fn next(state: &Cell<u32>) -> i32 {
    let moved = state.get().wrapping_mul(214_013).wrapping_add(2_531_011);
    state.set(moved);
    ((moved >> 16) & 0x7fff) as i32
}
