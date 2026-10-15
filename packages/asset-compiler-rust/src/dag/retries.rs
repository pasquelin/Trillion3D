//! The lock retries every reduction of a group runs (`solved.rs`): one driver, the pass it retries
//! given as a closure, and the one pass it reads. Why each retry exists: `reduce.rs`, **Added
//! locks**.
use super::border::{lock_triangles_touching, lost_locks};
use super::placed::Local;
use super::quality::backlit_corners;
use super::stopped::Stop;
use super::{attributes, GroupReductionInput, Result};
use trillion3d_math::triangle::longest_edge;

/// Times group restarted with extra locks before declared lost.
const BORDER_RETRIES: usize = 3;

/// Runs `pass` under the locks added so far (welded, sorted) until no lock is lost and no face
/// asks for one it does not already have; the pass kept, and whether locks were added. A lock
/// lost on every one of `BORDER_RETRIES` retries stops with `Stop::BorderLost`. `source` holds the
/// group's triangles, `required` its welded locks.
pub(super) fn with_lock_retries<'r, 'i, 'a>(
    source: &[u32],
    required: &[u32],
    weld: &[u32],
    mut pass: impl FnMut(&[u32]) -> Result<std::result::Result<Reduction<'r, 'i, 'a>, Stop>>,
) -> Result<std::result::Result<(Reduction<'r, 'i, 'a>, bool), Stop>> {
    let (mut extra, mut retries) = (Vec::new(), 0usize);
    loop {
        let mut done = match pass(&extra)? {
            Ok(done) => done,
            Err(stop) => return Ok(Err(stop)),
        };
        let lost = lost_locks(required, &done.local.kept(), weld);
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

/// One pass of a reduction: the region after the simplifier, its error so far, and whether it ran
/// under the group's locks.
pub(super) struct Reduction<'r, 'i, 'a> {
    pub local: Local<'r>,
    pub error: f64,
    pub input: &'i GroupReductionInput<'a>,
    pub locked: bool,
}
impl Reduction<'_, '_, '_> {
    /// Points each corner at its own face's normal copy (`attributes::own_normals`) and returns the
    /// corners to lock, welded: those of faces longer than the error lit from behind, and those no
    /// copy turned its way.
    /// A pass without locks — a diagnosis rerun — retries nothing.
    fn faces(&mut self) -> Vec<u32> {
        let (input, local) = (self.input, &mut self.local);
        let Some(normals) = local.normals.take() else {
            return Vec::new();
        };
        let weld_seam = local.weld_seam(input);
        let positions = &local.positions;
        let foreign = attributes::own_normals(
            &mut local.indices,
            local.source,
            &weld_seam,
            positions,
            normals.as_slice(),
        );
        let mut retry = Vec::new();
        if self.locked {
            // A face no longer than the error is under a pixel wherever it is drawn: lit from
            // behind or not, it asks for no lock. Without this exemption a group the seams freed
            // stalled again on such faces.
            let error = self.error;
            let seen: Vec<u32> = (local.indices.as_chunks::<3>().0.iter())
                .filter(|tri| longest_edge(positions, tri) > error)
                .flatten()
                .copied()
                .collect();
            let bound = input.normal_bound;
            retry = backlit_corners(&seen, positions, &normals, &local.weld, bound);
            retry.extend(foreign);
        }
        local.normals = Some(normals);
        retry
            .into_iter()
            .map(|c| input.weld[local.from(c)])
            .collect()
    }
}
