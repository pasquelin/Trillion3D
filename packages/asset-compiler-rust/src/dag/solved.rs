//! Seam-locked groups coarsen with solved vertices (Hoppe 1999).
//!
//! A group the diagnosis names `seam-locked` (`diagnosis.rs`) stalls because the positions it
//! could move are seam corners the endpoint reduction protects; welded across its seams, it
//! halves. It is retried with the solve (`qem_solve`): its locks kept, its seams unprotected but
//! where a chart meets its mirror image — a coordinate averaged across a mirror is neither
//! side's — each surviving position moved to the minimum of its quadric and each of its copies
//! given a texture coordinate and a normal of its own, solved at that point. The vertices it
//! writes are placed after the primitive's (`placed.rs`, `grown.rs`). Every other group keeps the
//! endpoint reduction: the DAG, the pages and the memory of an unblocked primitive do not move.
//!
//! **Derived weights.** A texture set weighs, against the group's extent, the surface length one
//! unit of it spans in the group — the square root of the group's surface area over its texture
//! area: a coordinate that slides by `d` draws the texture as far off as a position moved by `d`
//! times that length. Normals keep the endpoint reduction's weight (`attributes::NORMAL_WEIGHT`).
//! The largest step a placed coordinate took, clamp included, times that length joins the
//! group's error (`placed::Local::drift`).
//!
//! The retries are the endpoint reduction's: a lost lock locks its triangles, three times at
//! most; a face lit from behind locks its surroundings as long as that locks something new.
use super::border::{lock_triangles_touching, lost_locks, required_locks};
use super::charts::{densities, open_border_welded, weighted};
use super::placed::{Local, Placed};
use super::quality::backlit_corners;
use super::reduce::{Stop, BORDER_RETRIES};
use super::*;
use crate::qem::solve::Region;
use crate::qem::{VERTEX_LOCK, VERTEX_PROTECT};

/// A solved reduction: its error, its clusters in the primitive's numbering — placed vertices
/// from the level's vertex count on — and the vertices it placed.
pub(super) struct Solved {
    pub error: f64,
    pub clusters: Vec<Vec<u32>>,
    pub placed: Placed,
    pub relocked: bool,
}

/// The outcome of a group whose endpoint reduction stalled on `stop`: diagnosed
/// (`diagnosis::cause`), and when seam-locked retried with the solve.
pub(super) fn stalled(
    input: &GroupReductionInput,
    live: &[u32],
    children: usize,
    stop: Stop,
) -> Result<std::result::Result<Solved, GroupOutcome>> {
    let cause = diagnosis::cause(input, live, children, stop)?;
    let solved = match cause {
        StallCause::SeamLocked => attempt(input, live, children)?,
        _ => None,
    };
    Ok(solved.ok_or_else(|| diagnosis::outcome(cause, input, live)))
}

/// Reduces the seam-locked group `live` with the solve; `None` when it yields no fewer clusters
/// than its `children`, or loses a lock on every retry.
fn attempt(input: &GroupReductionInput, live: &[u32], children: usize) -> Result<Option<Solved>> {
    let base = (input.positions.len() / 3) as u32;
    let required = required_locks(live, input.locks, input.weld);
    let densities = densities(input, live);
    let (live, weld_error) = &open_border_welded(input, live, &densities);
    let weighted = weighted(input, live, &densities);
    let region = Region::of(input.positions, &weighted, live)?;
    let mirrors = input.mirrors();
    let (mut extra, mut retries) = (Vec::new(), 0usize);
    loop {
        let flags = |v: u32| {
            let weld = input.weld[v as usize];
            let lock = input.locks[v as usize] || extra.binary_search(&weld).is_ok();
            let mirror = mirrors.get(v as usize) == Some(&true);
            (u8::from(lock) * VERTEX_LOCK) | (u8::from(mirror) * VERTEX_PROTECT)
        };
        let Some(solved) = region.solve(live.len() / 6, &flags) else {
            return Ok(None);
        };
        let error = (solved.error_object, *weld_error);
        // A lost lock reads the solve alone: the region is renumbered only once none is lost.
        let lost = lost_locks(&required, &solved.kept(), input.weld);
        if !lost.is_empty() {
            if retries == BORDER_RETRIES {
                return Ok(None);
            }
            retries += 1;
            let before = extra.len();
            lock_triangles_touching(live, &lost, input.weld, &mut extra);
            if extra.len() > before {
                continue;
            }
        }
        let local = Local::of(input, solved, &densities);
        if let (true, Some(normals)) = (lost.is_empty(), &local.normals) {
            let (indices, positions) = (&local.indices, &local.positions);
            let bound = input.normal_bound;
            let corners = backlit_corners(indices, positions, normals, &local.weld, bound);
            let mut retry: Vec<u32> = corners.iter().map(|&c| input.weld[local.from(c)]).collect();
            retry.sort_unstable();
            retry.dedup();
            let before = extra.len();
            lock_triangles_touching(live, &retry, input.weld, &mut extra);
            if extra.len() > before {
                continue;
            }
        }
        return finish(input, local, error, &extra, children, base);
    }
}

/// The solved group re-clustered, `None` when it yields no fewer clusters than its `children`;
/// its error is the solve's, the parts it removed, the copies its open border welded and the
/// slide of its placed texture coordinates (`Local::drift`).
fn finish(
    input: &GroupReductionInput,
    local: Local,
    (error, weld_error): (f64, f64),
    extra: &[u32],
    children: usize,
    base: u32,
) -> Result<Option<Solved>> {
    let clusters = cluster_triangles(&local.positions, &local.indices, DAG_CLUSTER_TRIANGLES)?;
    if clusters.len() >= children {
        return Ok(None);
    }
    let (source, kept) = (&local.source, &local.indices);
    let vanished =
        vanished::vanished_error(source, kept, &local.positions, &local.weld, &local.extents);
    let global = |cluster: Vec<u32>| cluster.into_iter().map(|v| local.global(v, base)).collect();
    Ok(Some(Solved {
        error: error.max(vanished).max(weld_error).max(local.drift),
        clusters: clusters.into_iter().map(global).collect(),
        placed: local.placed(input, base),
        relocked: !extra.is_empty(),
    }))
}
