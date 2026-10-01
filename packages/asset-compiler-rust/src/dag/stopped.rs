//! Why an attempt stopped, before the stalled group is diagnosed.
//!
//! It lives here rather than in `reduce.rs` because four modules read it and one of them, `retries.rs`,
//! does nothing else with that module: with the verdict declared by the reduction, `reduce.rs` and
//! `retries.rs` imported each other, and a two-file cycle makes the load order of the DAG its own
//! decision. `diagnosis.rs` consumes it, and `solved.rs` returns it.

/// Why an attempt stopped. Each variant is the first thing that stopped it, before the group is
/// diagnosed: the source was too small to reduce, no collapse was found, or the border was lost.
#[derive(Clone, Copy)]
pub(super) enum Stop {
    TooSmall,
    NoCollapse,
    BorderLost,
}
