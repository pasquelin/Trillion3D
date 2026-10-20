//! THE REDUCTION of a group: the one region simplifier (`qem::solve`), one pass per target size,
//! and its error: the simplifier's own. It starts from the ghosts its children's reductions left
//! and hands its own on (`qem_simplifier_carry.rs`), those that can still open a hole above it.
//!
//! The ends of the edges another group shares are locked, the attributes weigh at their weights
//! (`DagAttributes::weighted`, `attributes::group_weighted`), and every vertex the simplifier
//! rewrote is placed (`placed.rs`).
use super::attributes::group_weighted;
use super::grown::Placed;
use super::placed::{Local, RegionWeld};
use super::*;
use crate::perf::{Phase, Timer};
use crate::qem::solve::{CarriedGhost, Region};

/// A reduction: its error, its clusters in the primitive's numbering — placed vertices from the
/// level's vertex count on —, and the vertices it placed.
pub(super) struct Solved {
    pub error: f64,
    pub clusters: Vec<Vec<u32>>,
    pub placed: Placed,
    /// The ghosts it hands on, in object space: those that can still open a hole above `error`
    /// (`CarriedGhost::outlasts`).
    pub ghosts: Vec<CarriedGhost>,
}

/// Reduces the group `corners` (its children's area `area` and worst error `child_error`) to
/// `parents` clusters, the ends of its external edges locked, from the ghosts `carried`. Its
/// error is the simplifier's, never below its children's, so the error never drops from a cluster
/// to its parent (`quality::check`). `None` when no target cluster size down to half a cluster fits.
///
/// The target is `parents` clusters of the cluster size less two triangles; the group is
/// simplified afresh towards it only when it holds more triangles, then re-split — a group with
/// more triangles than its parents can hold is not split at all. When the re-split needs more
/// clusters than `parents`, the target cluster size drops by two triangles and the group is
/// simplified afresh, down to just above half a cluster.
pub(super) fn attempt(
    input: &GroupReductionInput,
    corners: &[u32],
    (parents, area): (usize, f32),
    child_error: f64,
    carried: &[CarriedGhost],
) -> Result<Option<Solved>> {
    let weighted = group_weighted(input.weighted, corners);
    let is_locked = |v: u32| input.locks.get(v as usize).copied().unwrap_or(true);
    let region = Region::of(input.positions, &weighted, &is_locked, corners, area)?;
    let region_weld = RegionWeld::of(input, &region);
    let base = (input.positions.len() / 3) as u32;
    let mut cluster_size = DAG_CLUSTER_TRIANGLES - 2;
    loop {
        let mut solved = {
            let _t = Timer::new(Phase::Simplify);
            region.solve(parents * cluster_size, carried)
        };
        let error = solved.error_object.max(child_error);
        let handing = solved.handing.take();
        let local = Local::of(solved, &region_weld);
        if local.indices.len() / 3 <= parents * DAG_CLUSTER_TRIANGLES {
            let clusters = {
                let _t = Timer::new(Phase::Resplit);
                cluster_triangles(&local.positions, &local.indices, DAG_CLUSTER_TRIANGLES)?
            };
            if clusters.len() <= parents {
                let global = |cluster: Vec<u32>| -> Vec<u32> {
                    cluster.into_iter().map(|v| local.global(v, base)).collect()
                };
                // Kept: the one place the ghosts to hand on are chosen.
                let ghosts = match handing {
                    Some(handing) => handing.ghosts(error),
                    None => carried
                        .iter()
                        .filter(|g| g.outlasts(error))
                        .copied()
                        .collect(),
                };
                return Ok(Some(Solved {
                    error,
                    ghosts,
                    placed: local.placed(input, base),
                    clusters: clusters.into_iter().map(global).collect(),
                }));
            }
        }
        cluster_size -= 2;
        if cluster_size <= DAG_CLUSTER_TRIANGLES / 2 {
            return Ok(None);
        }
    }
}
