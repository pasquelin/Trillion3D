//! THE REDUCTION of a group: the one region simplifier (`qem::solve`), one pass per target size,
//! and its error: the simplifier's own.
//!
//! The ends of the edges another group shares are locked, the attributes weigh at their weights
//! (`DagAttributes::weighted`, `attributes::group_weighted`), and every vertex the simplifier
//! rewrote is placed (`placed.rs`).
use super::attributes::group_weighted;
use super::grown::Placed;
use super::placed::{Local, RegionWeld};
use super::*;
use crate::perf::{Phase, Timer};
use crate::qem::solve::Region;
use trillion3d_page_codec::min_ball::point_sphere;

/// A reduction: its error, its clusters in the primitive's numbering — placed vertices from the
/// level's vertex count on —, the vertices it placed, and the smallest ball of its triangles.
pub(super) struct Solved {
    pub error: f64,
    pub clusters: Vec<Vec<u32>>,
    pub placed: Placed,
    pub sphere: [f64; 4],
}

/// Reduces the group `corners` (its children's area `area` and worst error `child_error`) to
/// `parents` clusters, the ends of its external edges locked. Its error is the simplifier's,
/// never below its children's, so the error never drops from a cluster to its parent
/// (`quality::check`). `None` when no target cluster size down to half a cluster fits.
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
) -> Result<Option<Solved>> {
    let weighted = group_weighted(input.weighted, corners);
    let is_locked = |v: u32| input.locks.get(v as usize).copied().unwrap_or(true);
    let region = Region::of(input.positions, &weighted, &is_locked, corners, area)?;
    let region_weld = RegionWeld::of(input, &region);
    let base = (input.positions.len() / 3) as u32;
    let mut cluster_size = DAG_CLUSTER_TRIANGLES - 2;
    loop {
        let solved = {
            let _t = Timer::new(Phase::Simplify);
            region.solve(parents * cluster_size)
        };
        let error = solved.error_object.max(child_error);
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
                return Ok(Some(Solved {
                    error,
                    sphere: point_sphere(&local.positions, &local.indices),
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
