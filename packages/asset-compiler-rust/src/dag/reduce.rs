//! Group reduction: the simplifier, then what happens when it stalls.
//!
//! The group's corners first point at their exact copy (`attributes::weld_exact`): an unindexed
//! mesh reduces as the indexed one it draws the same as. The simplifier weighs normals and texture
//! sets and, in permissive mode, collapses across a hard edge rather than stall on it (`qem.rs`):
//! meshoptimizer otherwise slides a copied position only along its seam and locks any position
//! present in more than two copies, which on disjoint slabs reduced nothing. Texture seams stay
//! protected — welding them was measured on Emerald facades, drawn with the texture from the
//! other side of the seam — and every coarse corner points back at the copy of its position whose
//! normal matches its own face (`attributes::own_normals`). The group's twins stand for each other
//! through its own first copy, so a coarse page names only vertices its children draw.
//!
//! **Parts removed whole** cost their own extent and their distance to the surface kept
//! (`vanished.rs`): a part drops only at the level whose error covers it.
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
//! its top kept its underside there, on the top's and the edges' normals (#484). One driver runs
//! these retries for the endpoint and the solved reductions alike (`retries.rs`).
use super::*;
use crate::qem::{SimplifiedMesh, VERTEX_LOCK, VERTEX_PROTECT};
use border::{live_triangles, required_locks};
use retries::{with_lock_retries, Endpoint};

/// Succeeded reduction: simplified surface and re-clustered result.
pub(super) struct Attempt {
    simplified: SimplifiedMesh,
    clusters: Vec<Vec<u32>>,
    /// Locks added to preserve border.
    relocked: bool,
}
impl Attempt {
    /// Reduction yielding no fewer clusters than received does not advance DAG.
    pub(super) fn progresses(&self, children: usize) -> bool {
        self.clusters.len() < children
    }
}
/// Why an attempt stopped, before the stalled group is diagnosed.
#[derive(Clone, Copy)]
pub(super) enum Stop {
    TooSmall,
    NoCollapse,
    BorderLost,
}

pub(super) fn reduce_group(
    input: &GroupReductionInput,
    children: &[&DagCluster],
) -> Result<std::result::Result<GroupReduction, GroupOutcome>> {
    let mut spheres = Vec::with_capacity(children.len());
    let mut child_error = 0.0_f64;
    let mut source_rank = u32::MAX;
    for child in children {
        spheres.push(child.sphere);
        child_error = child_error.max(child.lod_error);
        source_rank = source_rank.min(child.source_rank);
    }
    let sphere = enclosing_sphere(&spheres);
    let mut own: HashMap<u32, u32> = HashMap::new();
    let corners = children.iter().flat_map(|c| c.indices.iter());
    let live = live_triangles(corners.map(|&v| *own.entry(input.exact[v as usize]).or_insert(v)));
    let (error, clusters, relocked, placed) = match attempt(input, &live, true)? {
        // Reduction yielding no fewer clusters does not advance DAG: refused,
        // even if removing triangles, rather than adding unreplaced level.
        Ok(chosen) if chosen.progresses(children.len()) => {
            let kept = &chosen.simplified.indices;
            let vanished =
                vanished::vanished_error(&live, kept, input.positions, input.weld, input.extents);
            let error = vanished.max(chosen.simplified.error_object);
            let folded = folded_after_solve(input, &live, kept);
            (error.max(folded), chosen.clusters, chosen.relocked, None)
        }
        stalled => {
            let stop = stalled.err().unwrap_or(Stop::NoCollapse);
            match solved::stalled(input, &live, children.len(), stop)? {
                Ok(s) => (s.error, s.clusters, s.relocked, Some(s.placed)),
                Err(outcome) => return Ok(Err(outcome)),
            }
        }
    };
    let error = error.max(child_error);
    if !error.is_finite() {
        return Ok(Err(diagnosis::outcome(
            StallCause::UnusableError,
            input,
            &live,
        )));
    }
    Ok(Ok(GroupReduction {
        error,
        sphere,
        clusters,
        source_rank,
        relocked,
        placed,
    }))
}

/// Where `live` names a vertex a solve placed, the longest face of `kept` across two texture
/// islands (`charts::folded_span`): a later collapse may join islands a placed vertex's seams no
/// longer hold. Zero elsewhere: a primitive no solve touched keeps its bytes.
fn folded_after_solve(input: &GroupReductionInput, live: &[u32], kept: &[u32]) -> f64 {
    if input.positions.len() / 3 == input.source_vertices {
        return 0.0;
    }
    let placed = live.iter().any(|&v| v as usize >= input.source_vertices);
    let islands = if placed { input.islands } else { &[] };
    charts::folded_span(kept, input.positions, islands, |v| v as usize)
}

/// Simplifies `source` to half triangles, restarting with extra locks as long as a shared vertex
/// disappears or a face turns its back on its normals (`retries.rs`), then re-clusters the
/// result. `locked` false drops every lock, the level's and the retries': the diagnosis of a
/// stalled group asks what they cost.
pub(super) fn attempt(
    input: &GroupReductionInput,
    source: &[u32],
    locked: bool,
) -> Result<std::result::Result<Attempt, Stop>> {
    let (locks, weld) = (input.locks, input.weld);
    let triangles = source.len() / 3;
    if triangles < 2 {
        return Ok(Err(Stop::TooSmall));
    }
    let required = if locked {
        required_locks(source, locks, weld)
    } else {
        Vec::new()
    };
    let pass = |extra: &[u32]| -> Result<std::result::Result<Endpoint, Stop>> {
        let simplified = {
            let _t = Timer::new(Phase::Simplify);
            simplify_with_locked_vertices(
                input.positions,
                input.weighted,
                source,
                triangles / 2,
                extra.is_empty(),
                &|vertex| {
                    let lock = locked
                        && (locks.get(vertex as usize).copied().unwrap_or(true)
                            || extra.binary_search(&weld[vertex as usize]).is_ok());
                    let seam = input.seams.get(vertex as usize).copied().unwrap_or(false);
                    (u8::from(lock) * VERTEX_LOCK) | (u8::from(seam) * VERTEX_PROTECT)
                },
            )?
        };
        if simplified.triangles >= triangles || simplified.indices.is_empty() {
            return Ok(Err(Stop::NoCollapse));
        }
        Ok(Ok(Endpoint {
            simplified,
            input,
            source,
            locked,
        }))
    };
    let (done, relocked) = match with_lock_retries(source, &required, weld, pass)? {
        Ok(done) => done,
        Err(stop) => return Ok(Err(stop)),
    };
    let clusters = {
        let _t = Timer::new(Phase::Resplit);
        cluster_triangles(
            input.positions,
            &done.simplified.indices,
            DAG_CLUSTER_TRIANGLES,
        )?
    };
    Ok(Ok(Attempt {
        simplified: done.simplified,
        clusters,
        relocked,
    }))
}
