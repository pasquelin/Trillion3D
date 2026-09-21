//! Group reduction: the simplifier, then what happens when it stalls.
//!
//! Two retries, each measured on a real scene before they existed:
//! - **Position welding** (`QemEndpoints` only). meshoptimizer only slides a copied
//!   position — UV seam, hard edge — along its seam. On disjoint slabs that meet
//!   only at corners it reduces nothing; on a trunk full of seams it consumes
//!   ordinary vertices then stalls at ÷2 (measured: 15 825 → 7 869 → 5 967 →
//!   5 680 → 5 647 triangles, 881 ordinary vertices for 1 582 seams and 259
//!   complex ones at the top of the DAG, and nothing below 5 635 even with zero
//!   locks). When reduction yields no fewer clusters than it received, it is
//!   retried on indices welded by (position, uv): copies that differ only by
//!   normal or colour become one, coarse levels point at the welded survivor —
//!   its normal stands for the others, that is the declared cost — and level
//!   zero is unchanged. Welding texture seams too was tried and measured: Emerald
//!   facades at the 2 px threshold drew with the texture from the other side of
//!   the seam. Refused. Under `QemAttributes` the welded survivor's attributes
//!   are solved rather than chosen (`reduce_attributes.rs`), and the weld follows
//!   the buffer as coarse levels create vertices.
//! - **Added locks.** On foliage, a chart whose edge is shared with another group
//!   disappears when its free vertices collapse onto locked vertices, and the
//!   other group keeps its half (measured: 92 groups of 123 lost that way, 339
//!   locks lost, all on a locked edge). The retry locks all three corners of
//!   every triangle that touched a lost lock and restarts: some charts remain,
//!   the rest of the group reduces.
use super::*;
use border::{live_triangles, lock_triangles_touching, lost_locks, required_locks};

/// Times group restarted with extra locks before declared lost.
const BORDER_RETRIES: usize = 3;

/// Succeeded reduction: simplified surface, re-clustered, and the vertices it created.
pub(super) struct Attempt {
    pub error_object: f64,
    pub clusters: Vec<Vec<u32>>,
    pub vertices: NewVertices,
    /// Locks added to preserve border.
    pub relocked: bool,
}
impl Attempt {
    /// Reduction yielding no fewer clusters than received does not advance DAG.
    fn progresses(&self, children: usize) -> bool {
        self.clusters.len() < children
    }
}
/// One run of the simplifier: reduced and re-clustered, stalled, or reduced but missing a
/// vertex the neighbours rely on — the welded locks it lost.
pub(super) enum Try {
    Done(Attempt),
    NoCollapse,
    Lost(Vec<u32>),
}
impl Try {
    /// Judges a reduction by its border: `corners` are what survived, in buffer indices or
    /// `NEW_VERTEX` ranks, which count for no lock.
    pub(super) fn of(
        required: &[u32],
        corners: &[u32],
        weld: &[u32],
        done: impl FnOnce() -> Result<Attempt>,
    ) -> Result<Self> {
        let lost = lost_locks(required, corners, weld);
        if lost.is_empty() {
            Ok(Try::Done(done()?))
        } else {
            Ok(Try::Lost(lost))
        }
    }
}

pub(super) fn reduce_group(
    input: &GroupReductionInput,
    children: &[&DagCluster],
) -> Result<std::result::Result<GroupReduction, GroupOutcome>> {
    let mut merged = Vec::with_capacity(children.iter().map(|c| c.indices.len()).sum());
    let mut spheres = Vec::with_capacity(children.len());
    let mut child_error = 0.0_f64;
    let mut source_rank = u32::MAX;
    for child in children {
        merged.extend_from_slice(&child.indices);
        spheres.push(child.sphere);
        child_error = child_error.max(child.lod_error);
        source_rank = source_rank.min(child.source_rank);
    }
    let sphere = enclosing_sphere(&spheres);
    let live = live_triangles(merged.iter().copied());
    let raw = attempt(input, &live)?;
    // Reduction yielding no fewer clusters does not advance DAG: refused,
    // even if removing triangles, rather than adding unreplaced level.
    let (chosen, welded) = match raw {
        Ok(raw) if raw.progresses(children.len()) => (raw, false),
        raw => {
            let welded_indices =
                live_triangles(merged.iter().map(|&i| input.weld_seam[i as usize]));
            // Already indexed mesh, with no copy to weld, does not restart for same result.
            let welded = if welded_indices == live {
                Err(GroupOutcome::NoCollapse)
            } else {
                attempt(input, &welded_indices)?
            };
            match welded {
                Ok(welded) if welded.progresses(children.len()) => (welded, true),
                Ok(_) => return Ok(Err(GroupOutcome::NoCollapse)),
                Err(outcome) => return Ok(Err(raw.err().unwrap_or(outcome))),
            }
        }
    };
    let error = chosen.error_object.max(child_error);
    if !error.is_finite() {
        return Ok(Err(GroupOutcome::UnusableError));
    }
    Ok(Ok(GroupReduction {
        error,
        sphere,
        clusters: chosen.clusters,
        source_rank,
        welded,
        relocked: chosen.relocked,
        vertices: chosen.vertices,
    }))
}

/// Simplifies `source` to half triangles, restarting with extra locks as long
/// as shared vertex disappears, then re-clusters result.
fn attempt(
    input: &GroupReductionInput,
    source: &[u32],
) -> Result<std::result::Result<Attempt, GroupOutcome>> {
    let (locks, weld) = (input.locks, input.weld);
    if source.len() / 3 < 2 {
        return Ok(Err(GroupOutcome::TooSmall));
    }
    let required = required_locks(source, locks, weld);
    let mut extra: Vec<u32> = Vec::new();
    let mut retries = 0usize;
    loop {
        let lock = |vertex: u32| {
            locks.get(vertex as usize).copied().unwrap_or(true)
                || extra.binary_search(&weld[vertex as usize]).is_ok()
        };
        let tried = {
            let _t = Timer::new(Phase::Simplify);
            match input.strategy {
                DagStrategy::QemAttributes => {
                    reduce_attributes::updated(input, source, &required, &lock)?
                }
                _ => endpoints(input, source, &required, &lock)?,
            }
        };
        match tried {
            Try::Done(mut attempt) => {
                attempt.relocked = retries > 0;
                return Ok(Ok(attempt));
            }
            Try::NoCollapse => return Ok(Err(GroupOutcome::NoCollapse)),
            Try::Lost(_) if retries == BORDER_RETRIES => return Ok(Err(GroupOutcome::BorderLost)),
            Try::Lost(lost) => {
                retries += 1;
                lock_triangles_touching(source, &lost, weld, &mut extra);
            }
        }
    }
}

/// `QemEndpoints`: the positional simplifier, its collapses landing on source vertices.
fn endpoints(
    input: &GroupReductionInput,
    source: &[u32],
    required: &[u32],
    lock: &dyn Fn(u32) -> bool,
) -> Result<Try> {
    let triangles = source.len() / 3;
    let simplified = simplify_with_locked_vertices(
        input.positions,
        source,
        triangles / 2,
        SIMPLIFY_ERROR_CEILING,
        lock,
    )?;
    if simplified.triangles >= triangles || simplified.indices.is_empty() {
        return Ok(Try::NoCollapse);
    }
    Try::of(required, &simplified.indices, input.weld, || {
        let clusters = {
            let _t = Timer::new(Phase::Resplit);
            cluster_triangles(input.positions, &simplified.indices, DAG_CLUSTER_TRIANGLES)?
        };
        Ok(Attempt {
            error_object: simplified.error_object,
            clusters,
            vertices: NewVertices::default(),
            relocked: false,
        })
    })
}
