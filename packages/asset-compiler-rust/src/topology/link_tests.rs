use super::*;

// Lot B5: classify_link lends a reused LinkScratch instead of allocating three lists and a stack
// per vertex. Cleared at entry on each of its dozens of outputs, including early returns:
// a block reused after an early exit must yield the same result as a fresh block
// neuf.

#[test]
fn classify_link_on_an_empty_link_is_locked() {
    let mut scratch = LinkScratch::default();
    assert_eq!(classify_link(&[], &mut scratch), "locked");
}

#[test]
fn classify_link_skips_a_self_loop_and_stays_locked() {
    let mut scratch = LinkScratch::default();
    assert_eq!(classify_link(&[(4, 4)], &mut scratch), "locked");
}

#[test]
fn classify_link_classifies_a_closed_fan_as_interior() {
    let mut scratch = LinkScratch::default();
    let links = [(1u32, 2u32), (2, 3), (3, 1)];
    assert_eq!(classify_link(&links, &mut scratch), "interior");
}

#[test]
fn classify_link_classifies_an_open_fan_as_boundary() {
    let mut scratch = LinkScratch::default();
    let links = [(1u32, 2u32), (2, 3)];
    assert_eq!(classify_link(&links, &mut scratch), "boundary");
}

#[test]
fn classify_link_reuses_scratch_after_an_early_return_without_leaking_state() {
    let mut scratch = LinkScratch::default();
    // Three edges on the same vertex: the third exits early with "locked", leaving the work
    // block half filled (ids, neighbours, and degree set, seen and stack never touched).
    let non_manifold = [(1u32, 2u32), (1, 3), (1, 4)];
    assert_eq!(classify_link(&non_manifold, &mut scratch), "locked");
    // The same block, reused on a clean closed fan, must yield the same result as a
    // fresh block: the function clears it completely at entry, regardless of the state left by
    // the previous call.
    let closed = [(10u32, 20u32), (20, 30), (30, 10)];
    assert_eq!(classify_link(&closed, &mut scratch), "interior");
    // And a third call, open this time, confirms that each call starts fresh from scratch.
    let open = [(10u32, 20u32), (20, 30)];
    assert_eq!(classify_link(&open, &mut scratch), "boundary");
}
