//! THE REDUCTION of a group: the one region simplifier (`qem::solve`), its lock retries
//! (`retries.rs`), the vertices it placed (`placed.rs`, `grown.rs`) and the error measured on its
//! own arrays (`measured::step_error`: the removed parts, the Hausdorff distance, the texture
//! deviation). Every group runs it the same way; what changes is what it holds still (`Hold`).
//!
//! **Seams held** (every group first): positions another group shares stay locked, texture seams
//! are protected, the attributes weigh as the level weighs them (`DagAttributes::weighted`), and
//! each surviving vertex stays the source vertex it collapsed onto: no vertex is placed, so the
//! level's arrays hold only source vertices and a page holds as many vertices as its cluster.
//!
//! **Seams freed** (a group the diagnosis names `seam-locked`, `diagnosis.rs`): its locks kept, its
//! seams unprotected, each copy of a surviving position given a texture coordinate and a normal of
//! its own, at the minimum of its quadric (placed vertices). A texture set then weighs the surface length one unit of it spans in the group
//! (`charts::densities`), the copies on the open border are welded (`charts::open_border_welded`),
//! and a face across two texture islands is charged its longest edge (`charts::folded_span`).
use super::border::required_locks;
use super::charts::{densities, folded_span, open_border_welded, weighted};
use super::grown::Placed;
use super::placed::Local;
use super::retries::{with_lock_retries, Reduction};
use super::stopped::Stop;
use super::*;
use crate::perf::{Phase, Timer};
use crate::qem::solve::{flags, Region};

/// What a reduction holds still.
#[derive(Clone, Copy)]
pub(super) struct Hold {
    /// The positions other groups share (`input.locks`), and every lock a retry adds.
    pub locked: bool,
    /// Texture seams protected; freed, each copy solves its own coordinates.
    pub seams: bool,
}

/// A reduction: its error, its clusters in the primitive's numbering — placed vertices from the
/// level's vertex count on — and the vertices it placed.
pub(super) struct Solved {
    pub error: f64,
    pub clusters: Vec<Vec<u32>>,
    pub placed: Placed,
    pub relocked: bool,
}

/// Reduces the group `live` (`children` clusters, the worst of them `child_error`) under `hold`.
/// Stops with `Stop::NoCollapse` when it yields no fewer clusters than `children`, and as the
/// retries stop (`retries.rs`).
pub(super) fn attempt(
    input: &GroupReductionInput,
    live: &[u32],
    hold: Hold,
    children: usize,
    child_error: f64,
) -> Result<std::result::Result<Solved, Stop>> {
    let base = (input.positions.len() / 3) as u32;
    reduced(
        input,
        live,
        hold,
        children,
        |local, error, relocked, clusters| {
            let placed = local.placed(input, base);
            let (weld_seam, uv_sets) = local.measured(input, &placed);
            let surface = measured::Surface {
                positions: &local.positions,
                weld: &local.weld,
                weld_seam: &weld_seam,
                extents: &local.extents,
                uv_sets: uv_sets.iter().map(Vec::as_slice).collect(),
            };
            let error =
                measured::step_error(&surface, local.source, &local.indices, error, child_error);
            let global =
                |cluster: Vec<u32>| cluster.into_iter().map(|v| local.global(v, base)).collect();
            Ok(Solved {
                error,
                clusters: clusters.into_iter().map(global).collect(),
                placed,
                relocked,
            })
        },
    )
}

/// Whether the group `live` reduces under `hold` to fewer clusters than `children`: the
/// diagnosis's yes or no, which stops at the cluster count and measures nothing.
pub(super) fn advances(
    input: &GroupReductionInput,
    live: &[u32],
    hold: Hold,
    children: usize,
) -> Result<bool> {
    Ok(reduced(input, live, hold, children, |_, _, _, _| Ok(()))?.is_ok())
}

/// The one reduction up to its cluster count: simplify under `hold` with its lock retries,
/// re-cluster, stop unless fewer clusters than `children`; then `finish` the region, its error so
/// far, whether locks were added and its clusters (region numbering).
fn reduced<T>(
    input: &GroupReductionInput,
    live: &[u32],
    hold: Hold,
    children: usize,
    finish: impl FnOnce(Local<'_>, f64, bool, Vec<Vec<u32>>) -> Result<T>,
) -> Result<std::result::Result<T, Stop>> {
    if live.len() / 3 < 2 {
        return Ok(Err(Stop::TooSmall));
    }
    let required = match hold.locked {
        true => required_locks(live, input.locks, input.weld),
        false => Vec::new(),
    };
    let (live, weld_error, weighted) = if hold.seams {
        (live.to_vec(), 0.0, input.weighted.to_vec())
    } else {
        let densities = densities(input.positions, &input.attributes.uv_sets(), live);
        let (welded, error) = open_border_welded(input, live, &densities);
        let weighted = weighted(input, &welded, &densities);
        (welded, error, weighted)
    };
    let live = live.as_slice();
    let region = Region::of(input.positions, &weighted, live)?;
    let pass = |extra: &[u32]| -> Result<std::result::Result<Reduction, Stop>> {
        let flag = |v: u32| {
            let lock = hold.locked
                && (input.locks.get(v as usize).copied().unwrap_or(true)
                    || extra.binary_search(&input.weld[v as usize]).is_ok());
            let seam = hold.seams && input.seams.get(v as usize).copied().unwrap_or(false);
            flags(lock, seam)
        };
        // Only a seam-freed group places vertices: its copies each solve their own attributes.
        // Pruning ignores locks: a retry, which added some, no longer prunes.
        let place = !hold.seams;
        let solved = {
            let _t = Timer::new(Phase::Simplify);
            region.solve(live.len() / 6, extra.is_empty(), place, &flag)
        };
        let Some(solved) = solved else {
            return Ok(Err(Stop::NoCollapse));
        };
        let error = solved.error_object.max(weld_error);
        let local = Local::of(input, solved);
        let (indices, positions) = (&local.indices, &local.positions);
        let span = folded_span(indices, positions, input.islands, |v| local.from(v));
        Ok(Ok(Reduction {
            error: error.max(span),
            local,
            input,
            locked: hold.locked,
        }))
    };
    let (Reduction { local, error, .. }, relocked) =
        match with_lock_retries(live, &required, input.weld, pass)? {
            Ok(done) => done,
            Err(stop) => return Ok(Err(stop)),
        };
    let clusters = {
        let _t = Timer::new(Phase::Resplit);
        cluster_triangles(&local.positions, &local.indices, DAG_CLUSTER_TRIANGLES)?
    };
    if clusters.len() >= children {
        return Ok(Err(Stop::NoCollapse));
    }
    finish(local, error, relocked, clusters).map(Ok)
}
