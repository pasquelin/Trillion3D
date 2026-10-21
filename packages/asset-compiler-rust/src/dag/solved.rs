//! THE REDUCTION of a group: the one region simplifier (`simplify::region`), one pass per target
//! size, and its error: the simplifier's own.
//!
//! The ends of the group's external edges are locked (`border.rs`), the attributes weigh at their
//! weights (`DagAttributes::weighted`, `attributes::group_weighted`), the solves keep the cook's
//! rules (`SolveRules`), and every vertex the simplifier rewrote is placed (`placed.rs`).
use super::attributes::group_weighted;
use super::border::Border;
use super::grown::Placed;
use super::placed::{Local, RegionWeld};
use super::*;
use crate::simplify::region::Region;
use crate::support::perf::{Phase, Timer};

/// A reduction: its error, its clusters in the primitive's numbering — placed vertices from the
/// level's vertex count on — with their external edges (`clusters.rs`) and identities
/// (`identity.rs`), and the vertices it placed. A reduction no target size re-split has no
/// cluster and placed nothing.
pub(super) struct Solved {
    pub error: f64,
    pub clusters: Vec<Vec<u32>>,
    pub outer: Vec<Vec<u8>>,
    pub identities: Vec<u64>,
    pub placed: Placed,
}

/// Reduces the group `corners` (its `border`, its children's area `area`, worst error
/// `child_error` and identity `identity`) to `parents` clusters, the ends of its external edges
/// locked; each new cluster's edges count what the border gives back to the solve's
/// (`Border::kept`) and their links to the other new clusters. Its error is the simplifier's,
/// never below its children's, so the error never drops from a cluster to its parent
/// (`quality::check`).
///
/// The target is `parents` clusters of the cluster size less two triangles; the group is
/// simplified afresh towards it only when it holds more triangles, then re-split — a group with
/// more triangles than its parents can hold is not split at all. When the re-split needs more
/// clusters than `parents`, the target cluster size drops by two triangles and the group is
/// simplified afresh, down to just above half a cluster; past it, the reduction keeps the last
/// solve's error and makes no cluster. A re-split of at most one cluster's triangles is that one
/// cluster, of the group's identity; any other gives each cluster its range (`identity::of_parts`).
pub(super) fn attempt(
    input: &GroupReductionInput,
    (corners, border): (&[u32], &Border),
    (parents, area): (usize, f32),
    (child_error, identity): (f64, u64),
) -> Result<Solved> {
    let weighted = group_weighted(input.weighted, corners, input.rules);
    let is_locked = |v: u32| border.locks(input.weld[v as usize]);
    let region = Region::of(
        input.positions,
        &weighted,
        &is_locked,
        corners,
        area,
        input.rules,
    )?;
    let region_weld = RegionWeld::of(input, &region);
    let base = (input.positions.len() / 3) as u32;
    let mut cluster_size = DAG_CLUSTER_TRIANGLES - 2;
    // Every target is the region simplified afresh; a lower one goes on from the last, which is
    // the same solve without the collapses already made (`Region::solve_from`).
    let mut run = None;
    loop {
        let target = parents * cluster_size;
        let solved = {
            let _t = Timer::new(Phase::Simplify);
            region.solve_from(&mut run, target)
        };
        let error = solved.error_object.max(child_error);
        let triangles = solved.indices.len() / 3;
        if triangles <= parents * DAG_CLUSTER_TRIANGLES {
            let local = Local::of(solved, &region_weld);
            let Cut { clusters, outer } = {
                let _t = Timer::new(Phase::Resplit);
                // A group already within its target is left as it was, its corners in order.
                let kept = match region.compact.len() / 3 > target {
                    true => border.kept(&local.positions, &local.indices),
                    false => border.outer.clone(),
                };
                let max = DAG_CLUSTER_TRIANGLES;
                cluster_triangles(&local.positions, &local.indices, max, &kept)?
            };
            if clusters.len() <= parents {
                let identities = match triangles <= DAG_CLUSTER_TRIANGLES {
                    true => vec![identity],
                    false => identity::of_parts(identity, clusters.iter().map(|c| c.len() / 3)),
                };
                let global = |cluster: Vec<u32>| -> Vec<u32> {
                    cluster.into_iter().map(|v| local.global(v, base)).collect()
                };
                return Ok(Solved {
                    error,
                    identities,
                    placed: local.placed(input, base),
                    clusters: clusters.into_iter().map(global).collect(),
                    outer,
                });
            }
        }
        cluster_size -= 2;
        if cluster_size <= DAG_CLUSTER_TRIANGLES / 2 {
            return Ok(Solved {
                error,
                clusters: Vec::new(),
                outer: Vec::new(),
                identities: Vec::new(),
                placed: Placed::default(),
            });
        }
    }
}
