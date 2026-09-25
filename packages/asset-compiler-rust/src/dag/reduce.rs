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
//! **Parts removed whole** cost their distance to the surface kept, and a reduction destroying one
//! (`vanished.rs`) is refused: a coarse level never destroys a part, the group stays roots.
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
use super::*;
use crate::qem::{SimplifiedMesh, VERTEX_LOCK, VERTEX_PROTECT};
use border::{live_triangles, lock_triangles_touching, lost_locks, required_locks};
use quality::backlit_corners;

/// Times group restarted with extra locks before declared lost.
const BORDER_RETRIES: usize = 3;

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
    let chosen = match attempt(input, &live, true)? {
        // Reduction yielding no fewer clusters does not advance DAG: refused,
        // even if removing triangles, rather than adding unreplaced level.
        Ok(chosen) if chosen.progresses(children.len()) => chosen,
        Ok(_) => return stall(input, &live, children.len(), Stop::NoCollapse),
        Err(stop) => return stall(input, &live, children.len(), stop),
    };
    let kept = &chosen.simplified.indices;
    let vanished = vanished::vanished(&live, kept, input.positions, input.weld);
    let own = chosen.simplified.error_object.max(child_error);
    let error = vanished.distance.max(own);
    if !error.is_finite() || vanished.destroys(&live, kept, input.positions, child_error) {
        return Ok(Err(diagnosis::outcome(
            StallCause::UnusableError,
            input,
            &live,
        )));
    }
    Ok(Ok(GroupReduction {
        error,
        sphere,
        clusters: chosen.clusters,
        source_rank,
        relocked: chosen.relocked,
    }))
}

fn stall(
    input: &GroupReductionInput,
    live: &[u32],
    children: usize,
    stop: Stop,
) -> Result<std::result::Result<GroupReduction, GroupOutcome>> {
    diagnosis::stalled(input, live, children, stop).map(Err)
}

/// Simplifies `source` to half triangles, restarting with extra locks as long as a shared vertex
/// disappears or a face turns its back on its normals, then re-clusters the result. `locked`
/// false drops every lock, the level's and the retries': the diagnosis of a stalled group asks
/// what they cost.
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
    let mut extra: Vec<u32> = Vec::new();
    let mut border_retries = 0usize;
    loop {
        let mut simplified = {
            let _t = Timer::new(Phase::Simplify);
            simplify_with_locked_vertices(
                input.positions,
                input.attributes,
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
        let lost = lost_locks(&required, &simplified.indices, weld);
        let retry = if !lost.is_empty() {
            if border_retries == BORDER_RETRIES {
                return Ok(Err(Stop::BorderLost));
            }
            border_retries += 1;
            lost
        } else if let Some(normals) = input.normals {
            let foreign = attributes::own_normals(
                &mut simplified.indices,
                source,
                input.weld_seam,
                input.positions,
                normals,
            );
            let bound = input.normal_bound;
            match locked {
                true => {
                    let indices = &simplified.indices;
                    let mut retry = backlit_corners(indices, input.positions, normals, weld, bound);
                    retry.extend(foreign.iter().map(|&v| weld[v as usize]));
                    retry.sort_unstable();
                    retry.dedup();
                    retry
                }
                false => Vec::new(),
            }
        } else {
            Vec::new()
        };
        let before = extra.len();
        if !retry.is_empty() {
            lock_triangles_touching(source, &retry, weld, &mut extra);
        }
        // A backlit face whose surroundings are all locked already cannot be helped by a retry.
        if retry.is_empty() || extra.len() == before {
            let clusters = {
                let _t = Timer::new(Phase::Resplit);
                cluster_triangles(input.positions, &simplified.indices, DAG_CLUSTER_TRIANGLES)?
            };
            return Ok(Ok(Attempt {
                simplified,
                clusters,
                relocked: !extra.is_empty(),
            }));
        }
    }
}
