//! The counts and ranks the file holds in 32-bit words are checked, never cut short.
use crate::ray_tracing::word::word;

#[test]
fn a_count_that_fits_a_word_is_kept() {
    assert_eq!(word(0, "nodes").unwrap(), 0);
    assert_eq!(word(u32::MAX as usize, "nodes").unwrap(), u32::MAX);
}

#[cfg(target_pointer_width = "64")]
#[test]
fn a_count_past_a_word_is_an_error_naming_what_it_counts() {
    let refused = word(u32::MAX as usize + 1, "triangle rank").expect_err("past a word");
    assert_eq!(refused.code, "RAY_TRACING_TOO_LARGE");
    assert!(refused.message.contains("triangle rank"), "{refused}");
}
