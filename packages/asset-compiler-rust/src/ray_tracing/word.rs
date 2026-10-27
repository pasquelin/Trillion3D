//! The checked `u32` of the counts and ranks `rayTracing.bin` holds in its 32-bit words: its head,
//! its records, and the cluster and triangle ranks of its triangles.
use crate::{CompilerError, Result};

/// `value`, a count or a rank of `what`, as the `u32` the file holds it in; an error when it does
/// not fit, so that the file never holds a count cut short.
pub(super) fn word(value: usize, what: &str) -> Result<u32> {
    u32::try_from(value).map_err(|_| {
        CompilerError::new(
            "RAY_TRACING_TOO_LARGE",
            format!("the ray tracing file's {what}, {value}, does not fit the 32-bit word it is held in"),
        )
    })
}
