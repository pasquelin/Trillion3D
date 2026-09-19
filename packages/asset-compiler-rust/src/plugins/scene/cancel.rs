//! Cancellation reread **inside** a mesh.
//!
//! A token read once per object is not enough: a scene of a single object with a million
//! faces then only stops once that million has been laid down. Drivers that split faces
//! therefore reread the token by slice, all through this helper and under the same named
//! refusal — a relaxed read every few thousand faces, which the corpus does not notice.
use crate::CompilerError;
use std::sync::atomic::{AtomicBool, Ordering};

/// Faces between two token reads: enough that the read weighs nothing, few enough that a
/// huge mesh stops without waiting for its last face.
const SLICE: usize = 4096;

/// True when the token is raised, reread at the start of each slice. `done` is the number of
/// faces already laid down by this mesh.
pub(super) fn stopped(cancelled: &AtomicBool, done: usize) -> bool {
    done.is_multiple_of(SLICE) && cancelled.load(Ordering::Relaxed)
}

/// Refusal that a cancelled compilation carries, the same for every driver.
pub(super) fn refusal() -> CompilerError {
    CompilerError::new("CANCELLED", "Import cancelled")
}
