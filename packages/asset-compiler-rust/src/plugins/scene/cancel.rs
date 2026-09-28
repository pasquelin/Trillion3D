//! Cancellation reread **inside** a mesh.
//!
//! A token read once per object is not enough: a scene of a single object with a million
//! faces then only stops once that million has been laid down. Drivers that split faces or
//! compute corner normals reread the token by slice, through this helper and the same named
//! refusal — a relaxed read every few thousand work items.
use crate::CompilerError;
use std::sync::atomic::{AtomicBool, Ordering};

/// Work items between token reads: faces or corners, according to the mesh stage.
const SLICE: usize = 4096;

/// True when the token is raised, reread at the start of each slice. `done` is the number of
/// work items already visited by this mesh stage.
pub(super) fn stopped(cancelled: &AtomicBool, done: usize) -> bool {
    done.is_multiple_of(SLICE) && cancelled.load(Ordering::Relaxed)
}

/// Refusal that a cancelled compilation carries, the same for every driver.
pub(super) fn refusal() -> CompilerError {
    CompilerError::new(crate::CANCELLED, "Import cancelled")
}
