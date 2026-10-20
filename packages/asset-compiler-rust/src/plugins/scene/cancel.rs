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
    done.is_multiple_of(SLICE) && raised(cancelled)
}

/// Whether the token is raised: the one read of it, a relaxed load.
pub(crate) fn raised(cancelled: &AtomicBool) -> bool {
    cancelled.load(Ordering::Relaxed)
}

/// `None` once the token is raised: a walk stops there with `?` and leaves the refusal to the
/// driver that started it (`check`).
pub(crate) fn going(cancelled: &AtomicBool) -> Option<()> {
    (!raised(cancelled)).then_some(())
}

/// Refusal that a cancelled compilation carries, the same for every stage and driver.
pub(crate) fn refusal() -> CompilerError {
    CompilerError::new(crate::CANCELLED, "Compilation cancelled")
}

/// Refuses as cancelled when the token is raised: the one check of every stage and driver.
pub(crate) fn check(cancelled: &AtomicBool) -> crate::Result<()> {
    match raised(cancelled) {
        true => Err(refusal()),
        false => Ok(()),
    }
}
