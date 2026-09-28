//! The lock retries every reduction of a group runs, the endpoint one (`reduce.rs`) and the solved
//! one (`solved.rs`) alike: one driver, the pass it retries given as a closure.
//!
//! **Added locks.** On foliage, a chart whose edge is shared with another group disappears when
//! its free vertices collapse onto locked vertices, and the other group keeps its half (measured:
//! 92 groups of 123 lost that way, 339 locks lost, all on a locked edge). The retry locks all
//! three corners of every triangle that touched a lost lock and restarts: some charts remain, the
//! rest of the group reduces. Pruning ignores locks, so a retry no longer prunes. A face the
//! reduction lit from behind (`quality::backlit_corners`) is retried the same way, as long as the
//! retry locks something new: collapses accumulated over levels flip small faces on spheres and
//! facades (measured: 13 of 49 levels of MetalRoughSpheres, 13 of 38 of facade-7). The retry
//! looks at every face but slivers, even one narrower than the error, which the published check
//! exempts: a coarse face spanning a log of a chalet, 6 m long and 0.22 m wide, came out inside
//! out at 0.78 m of error, its corners on the caps' normals (#415, #484). Refusing such a face
//! would refuse the cook; retrying it only costs a few locks. A face none of whose corner copies
//! a face turned its way draws is retried the same way: a board whose thickness collapsed onto
//! its top kept its underside there, on the top's and the edges' normals (#484).
use super::border::{lock_triangles_touching, lost_locks};
use super::reduce::Stop;
use super::Result;
use std::borrow::Cow;

/// Times group restarted with extra locks before declared lost.
const BORDER_RETRIES: usize = 3;

/// One pass of a reduction, as the driver reads it.
pub(super) trait Pass {
    /// The level's vertices the pass kept as they were, one per corner that names one.
    fn kept(&self) -> Cow<'_, [u32]>;
    /// Points each corner at its own face's normal copy and returns the corners to lock, welded:
    /// those of faces lit from behind and those no copy turned their face's way exists for.
    fn faces(&mut self) -> Vec<u32>;
}

/// Runs `pass` under the locks added so far (welded, sorted) until no lock is lost and no face
/// asks for one it does not already have; the pass kept, and whether locks were added. A lock
/// lost on every one of `BORDER_RETRIES` retries stops with `Stop::BorderLost`. `source` holds the
/// group's triangles, `required` its welded locks.
pub(super) fn with_lock_retries<P: Pass>(
    source: &[u32],
    required: &[u32],
    weld: &[u32],
    mut pass: impl FnMut(&[u32]) -> Result<std::result::Result<P, Stop>>,
) -> Result<std::result::Result<(P, bool), Stop>> {
    let (mut extra, mut retries) = (Vec::new(), 0usize);
    loop {
        let mut done = match pass(&extra)? {
            Ok(done) => done,
            Err(stop) => return Ok(Err(stop)),
        };
        let lost = lost_locks(required, &done.kept(), weld);
        let retry = if !lost.is_empty() {
            if retries == BORDER_RETRIES {
                return Ok(Err(Stop::BorderLost));
            }
            retries += 1;
            lost
        } else {
            let mut retry = done.faces();
            retry.sort_unstable();
            retry.dedup();
            retry
        };
        let before = extra.len();
        if !retry.is_empty() {
            lock_triangles_touching(source, &retry, weld, &mut extra);
        }
        // A face whose surroundings are all locked already cannot be helped by a retry.
        if extra.len() == before {
            return Ok(Ok((done, !extra.is_empty())));
        }
    }
}
