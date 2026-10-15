//! Group reduction: the one reduction (`solved.rs`) with the group's seams held, then, when it
//! stalls, the diagnosis (`diagnosis.rs`) and, for a seam-locked group, the same reduction with its
//! seams freed.
//!
//! The group's corners first point at their exact copy (`attributes::weld_exact`): an unindexed
//! mesh reduces as the indexed one it draws the same as. The simplifier weighs normals and texture
//! sets and, in permissive mode, collapses across a hard edge rather than stall on it (`qem.rs`):
//! the simplifier otherwise slides a copied position only along its seam and locks any position
//! present in more than two copies, which on disjoint slabs reduced nothing. Texture seams stay
//! protected — welding them was measured on Emerald facades, drawn with the texture from the
//! other side of the seam — and every coarse corner points back at the copy of its position whose
//! normal matches its own face (`attributes::own_normals`). The group's twins stand for each other
//! through its own first copy, so a coarse page names only vertices its children draw.
//!
//! **Parts removed whole** cost their own extent and their distance to the surface kept
//! (`vanished.rs`): a part drops only at the level whose error covers it. The error is never
//! below the geometry's measured distance (`measured.rs`).
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
//! exempts: a coarse face spanning a log of a log house, 6 m long and 0.22 m wide, came out inside
//! out at 0.78 m of error, its corners on the caps' normals. Refusing such a face
//! would refuse the cook; retrying it only costs a few locks. A face none of whose corner copies
//! a face turned its way draws is retried the same way: a board whose thickness collapsed onto
//! its top kept its underside there, on the top's and the edges' normals. One driver runs
//! these retries for every reduction (`retries.rs`).
use super::border::live_triangles;
use super::solved::{attempt, Hold};
use super::*;
use trillion3d_page_codec::min_ball::ball_of_balls;

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
    // The group's sphere encloses its children's final ones: a level-0 cluster's smallest ball and
    // every earlier group's, so each parent holds its children, the invariant the cut's
    // monotonicity rests on.
    let sphere = ball_of_balls(&spheres);
    let mut own: WordMap<u32, u32> = WordMap::default();
    let corners = children.iter().flat_map(|c| c.indices.iter());
    let live = live_triangles(corners.map(|&v| *own.entry(input.exact[v as usize]).or_insert(v)));
    let held = Hold {
        locked: true,
        seams: true,
    };
    // A reduction yielding no fewer clusters does not advance the DAG: refused, even if it removes
    // triangles, rather than adding an unreplaced level.
    let solved = match attempt(input, &live, held, children.len(), child_error)? {
        Ok(solved) => solved,
        Err(stop) => {
            let cause = diagnosis::cause(input, &live, children.len(), stop)?;
            let freed = Hold {
                locked: true,
                seams: false,
            };
            let retried = match cause {
                StallCause::SeamLocked => {
                    attempt(input, &live, freed, children.len(), child_error)?.ok()
                }
                _ => None,
            };
            match retried {
                Some(solved) => solved,
                None => return Ok(Err(diagnosis::outcome(cause, input, &live))),
            }
        }
    };
    if !solved.error.is_finite() {
        return Ok(Err(diagnosis::outcome(
            StallCause::UnusableError,
            input,
            &live,
        )));
    }
    Ok(Ok(GroupReduction {
        error: solved.error,
        sphere,
        clusters: solved.clusters,
        source_rank,
        relocked: solved.relocked,
        placed: Some(solved.placed),
    }))
}
