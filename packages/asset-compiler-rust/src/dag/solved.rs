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
//!
//! The retries are the endpoint reduction's: a lost lock locks its triangles, three times at
//! most; a face lit from behind locks its surroundings as long as that locks something new.
use super::border::{lock_triangles_touching, lost_locks, required_locks};
use super::charts::{densities, open_border_welded, weighted};
use super::grown::Placed;
use super::placed::Local;
use super::quality::backlit_corners;
use super::reduce::{Stop, BORDER_RETRIES};
use super::*;
use crate::qem::solve::simplify_with_update;
use crate::qem::{VERTEX_LOCK, VERTEX_PROTECT};

/// A solved reduction: its error, its clusters in the primitive's numbering — placed vertices
/// from the level's vertex count on — and the vertices it placed.
struct Solved {
    error: f64,
    clusters: Vec<Vec<u32>>,
    placed: Placed,
    relocked: bool,
}

/// The outcome of a group whose endpoint reduction stalled on `stop`: diagnosed
/// (`diagnosis::stalled`), and when seam-locked retried with the solve. `frame` holds the group's
/// sphere, its children's largest error and its source rank.
pub(super) fn stalled(
    input: &GroupReductionInput,
    live: &[u32],
    children: usize,
    stop: Stop,
    (sphere, child_error, source_rank): ([f64; 4], f64, u32),
) -> Result<std::result::Result<GroupReduction, GroupOutcome>> {
    let outcome = diagnosis::stalled(input, live, children, stop)?;
    let solved = match outcome.cause {
        StallCause::SeamLocked => attempt(input, live, children)?,
        _ => None,
    };
    let Some(solved) = solved else {
        return Ok(Err(outcome));
    };
    let error = solved.error.max(child_error);
    if !error.is_finite() {
        return Ok(Err(diagnosis::outcome(
            StallCause::UnusableError,
            input,
            live,
        )));
    }
    Ok(Ok(GroupReduction {
        error,
        sphere,
        clusters: solved.clusters,
        source_rank,
        relocked: solved.relocked,
        placed: Some(solved.placed),
    }))
}

/// Reduces the seam-locked group `live` with the solve; `None` when it yields no fewer clusters
/// than its `children`, or loses a lock on every retry.
fn attempt(input: &GroupReductionInput, live: &[u32], children: usize) -> Result<Option<Solved>> {
    let base = (input.positions.len() / 3) as u32;
    let required = required_locks(live, input.locks, input.weld);
    let densities = densities(input, live);
    let (live, weld_error) = &open_border_welded(input, live, &densities);
    let weighted = weighted(input, live, &densities);
    let (mut extra, mut retries) = (Vec::new(), 0usize);
    loop {
        let flags = |v: u32| {
            let weld = input.weld[v as usize];
            let lock = input.locks[v as usize] || extra.binary_search(&weld).is_ok();
            let mirror = input.mirrors.get(v as usize) == Some(&true);
            (u8::from(lock) * VERTEX_LOCK) | (u8::from(mirror) * VERTEX_PROTECT)
        };
        let target = live.len() / 6;
        let Some(region) = simplify_with_update(input.positions, &weighted, live, target, &flags)?
        else {
            return Ok(None);
        };
        let error = region.error_object;
        let local = Local::of(input, region, live);
        let lost = lost_locks(&required, &local.kept(), input.weld);
        let retry: Vec<u32> = if !lost.is_empty() {
            if retries == BORDER_RETRIES {
                return Ok(None);
            }
            retries += 1;
            lost
        } else if let Some(normals) = &local.normals {
            let bound = input.normal_bound;
            let corners = backlit_corners(
                &local.indices,
                &local.positions,
                normals,
                &local.weld,
                bound,
            );
            let mut retry: Vec<u32> = corners.iter().map(|&c| input.weld[local.from(c)]).collect();
            retry.sort_unstable();
            retry.dedup();
            retry
        } else {
            Vec::new()
        };
        let before = extra.len();
        lock_triangles_touching(live, &retry, input.weld, &mut extra);
        if extra.len() > before {
            continue;
        }
        let clusters = cluster_triangles(&local.positions, &local.indices, DAG_CLUSTER_TRIANGLES)?;
        if clusters.len() >= children {
            return Ok(None);
        }
        let (source, kept) = (&local.source, &local.indices);
        let vanished =
            vanished::vanished_error(source, kept, &local.positions, &local.weld, &local.extents);
        let global =
            |cluster: Vec<u32>| cluster.into_iter().map(|v| local.global(v, base)).collect();
        return Ok(Some(Solved {
            error: error.max(vanished).max(*weld_error),
            clusters: clusters.into_iter().map(global).collect(),
            placed: local.placed(input, base),
            relocked: !extra.is_empty(),
        }));
    }
}
