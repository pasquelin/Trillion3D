//! The lock retries every reduction of a group runs, the endpoint one (`reduce.rs`) and the solved
//! one (`solved.rs`) alike: one driver, the pass it retries given as a closure. Why each retry
//! exists: `reduce.rs`, **Added locks**.
use super::border::{lock_triangles_touching, lost_locks};
use super::quality::backlit_corners;
use super::stopped::Stop;
use super::{attributes, GroupReductionInput, Result};
use crate::qem::SimplifiedMesh;
use std::borrow::Cow;

/// Times group restarted with extra locks before declared lost.
const BORDER_RETRIES: usize = 3;

/// One pass of a reduction, as the driver reads it.
pub(super) trait Pass {
    /// The level's vertices the pass kept as they were, one per corner that names one.
    fn kept(&self) -> Cow<'_, [u32]>;
    /// Points each corner at its own face's normal copy and returns the corners to lock, welded:
    /// those of faces lit from behind and, on the endpoint pass, those no copy turned its way.
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

/// One endpoint pass, and what its faces are checked against.
pub(super) struct Endpoint<'i, 'a> {
    pub simplified: SimplifiedMesh,
    pub input: &'i GroupReductionInput<'a>,
    pub source: &'i [u32],
    pub locked: bool,
}
impl Pass for Endpoint<'_, '_> {
    fn kept(&self) -> Cow<'_, [u32]> {
        Cow::Borrowed(&self.simplified.indices)
    }
    fn faces(&mut self) -> Vec<u32> {
        let (input, indices) = (self.input, &mut self.simplified.indices);
        let Some(normals) = input.attributes.normals() else {
            return Vec::new();
        };
        let (weld_seam, positions) = (input.weld_seam, input.positions);
        let foreign = attributes::own_normals(indices, self.source, weld_seam, positions, normals);
        if !self.locked {
            return Vec::new();
        }
        let bound = input.normal_bound;
        let mut retry = backlit_corners(indices, positions, normals, input.weld, bound);
        retry.extend(foreign.iter().map(|&v| input.weld[v as usize]));
        retry
    }
}
