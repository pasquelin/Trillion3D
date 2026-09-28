//! Seam-locked groups coarsen with solved vertices (Hoppe 1999).
//!
//! A group the diagnosis names `seam-locked` (`diagnosis.rs`) stalls because the positions it
//! could move are seam corners the endpoint reduction protects; welded across its seams, it
//! halves. It is retried with the solve (`qem_solve`): its locks kept, its seams unprotected,
//! each surviving position moved to the minimum of its quadric and each of its copies given a
//! texture coordinate and a normal of its own, solved at that point. The vertices it writes are
//! placed after the primitive's (`placed.rs`, `grown.rs`). Every other group keeps the endpoint
//! reduction: the DAG, the pages and the memory of an unblocked primitive do not move.
//!
//! **Derived weights.** A texture set weighs, against the group's extent, the surface length one
//! unit of it spans in the group — the square root of the group's surface area over its texture
//! area: a coordinate that slides by `d` draws the texture as far off as a position moved by `d`
//! times that length. Normals keep the endpoint reduction's weight (`attributes::NORMAL_WEIGHT`).
//!
//! **Mirrors and islands.** Where a chart meets its mirror image (`charts::on_mirror`) the seam is
//! first kept: a face folded across a mirror draws one side's texture on the other with every
//! coordinate in place, a slide the solve's error does not see. A group those seams still hold is solved
//! across them, each face whose corners' charts turn both ways charged its longest edge; so is
//! every face whose corners lie in two texture islands: under a pixel wherever its level is drawn
//! (`charts::folded_span`).
//!
//! **Retries.** The endpoint reduction's (`retries.rs`), and so is the check of its faces: a kept
//! corner points at the copy of its own face's normal (`attributes::own_normals`), a face lit
//! from behind locks its surroundings — but a face no longer than the group's error, under a
//! pixel wherever its level is drawn: on a group the solve alone frees, locking every such face
//! stalled it again (Sponza: four groups of five).
use super::border::required_locks;
use super::charts::{
    densities, folded_span, longest_edge, on_mirror, open_border_welded, weighted, Chart,
};
use super::grown::Placed;
use super::placed::Local;
use super::quality::backlit_corners;
use super::reduce::Stop;
use super::retries::{with_lock_retries, Pass};
use super::*;
use crate::qem::solve::Region;
use crate::qem::{VERTEX_LOCK, VERTEX_PROTECT};
use std::borrow::Cow;

/// A solved reduction: its error, its clusters in the primitive's numbering — placed vertices
/// from the level's vertex count on — and the vertices it placed.
pub(super) struct Solved {
    pub error: f64,
    pub clusters: Vec<Vec<u32>>,
    pub placed: Placed,
    pub relocked: bool,
}

/// The outcome of a group whose endpoint reduction stalled on `stop`: diagnosed
/// (`diagnosis::cause`), and when seam-locked retried with the solve, its mirrors kept, then,
/// if they hold it and it has any, crossed.
pub(super) fn stalled(
    input: &GroupReductionInput,
    live: &[u32],
    children: usize,
    stop: Stop,
) -> Result<std::result::Result<Solved, GroupOutcome>> {
    let cause = diagnosis::cause(input, live, children, stop)?;
    let solved = match cause {
        StallCause::SeamLocked => match attempt(input, live, children, false)? {
            None if live.iter().any(|&v| on_mirror_vertex(input.charts, v)) => {
                attempt(input, live, children, true)?
            }
            kept => kept,
        },
        _ => None,
    };
    Ok(solved.ok_or_else(|| diagnosis::outcome(cause, input, live)))
}

/// Whether vertex `v` lies where a chart meets its mirror image (`charts::on_mirror`).
fn on_mirror_vertex(charts: &[Chart], v: u32) -> bool {
    charts.get(v as usize).is_some_and(|c| on_mirror(c.sides))
}

/// Reduces the seam-locked group `live` with the solve, across its mirrors when `crossed`;
/// `None` when it yields no fewer clusters than its `children`, or loses a lock on every retry.
fn attempt(
    input: &GroupReductionInput,
    live: &[u32],
    children: usize,
    crossed: bool,
) -> Result<Option<Solved>> {
    let base = (input.positions.len() / 3) as u32;
    let required = required_locks(live, input.locks, input.weld);
    let densities = densities(input.positions, &input.attributes.uv_sets(), live);
    let charts = input.charts;
    let mirror = |v: u32| !crossed && on_mirror_vertex(charts, v);
    let (live, weld_error) = &open_border_welded(input, live, &densities, mirror);
    let weighted = weighted(input, live, &densities);
    let region = Region::of(input.positions, &weighted, live)?;
    let pass = |extra: &[u32]| -> Result<std::result::Result<Solve, Stop>> {
        let flags = |v: u32| {
            let lock =
                input.locks[v as usize] || extra.binary_search(&input.weld[v as usize]).is_ok();
            (u8::from(lock) * VERTEX_LOCK) | (u8::from(mirror(v)) * VERTEX_PROTECT)
        };
        let Some(solved) = region.solve(live.len() / 6, &flags) else {
            return Ok(Err(Stop::NoCollapse));
        };
        let error = solved.error_object.max(*weld_error);
        let local = Local::of(input, solved);
        let span = match charts.is_empty() {
            true => 0.0,
            false => {
                let chart = |v: u32| charts[local.from(v)];
                folded_span(&local.indices, &local.positions, chart, crossed)
            }
        };
        Ok(Ok(Solve {
            error: error.max(span),
            local,
            input,
        }))
    };
    match with_lock_retries(live, &required, input.weld, pass)? {
        Ok((solve, relocked)) => finish(input, solve.local, solve.error, relocked, children, base),
        Err(_) => Ok(None),
    }
}

/// One solved pass, its error so far, and what its faces are checked against.
struct Solve<'r, 'i, 'a> {
    local: Local<'r>,
    error: f64,
    input: &'i GroupReductionInput<'a>,
}
impl Pass for Solve<'_, '_, '_> {
    fn kept(&self) -> Cow<'_, [u32]> {
        Cow::Owned(self.local.kept())
    }
    fn faces(&mut self) -> Vec<u32> {
        let (input, local) = (self.input, &mut self.local);
        let Some(normals) = &local.normals else {
            return Vec::new();
        };
        let (weld_seam, positions) = (local.weld_seam(input), &local.positions);
        let indices = &mut local.indices;
        attributes::own_normals(indices, local.source, &weld_seam, positions, normals);
        let error = self.error;
        let tris = indices.as_chunks::<3>().0.iter();
        let seen: Vec<u32> = tris
            .filter(|tri| longest_edge(positions, tri) > error)
            .flatten()
            .copied()
            .collect();
        let backlit = backlit_corners(&seen, positions, normals, &local.weld, input.normal_bound);
        backlit
            .into_iter()
            .map(|c| input.weld[local.from(c)])
            .collect()
    }
}

/// The solved group re-clustered, `None` when it yields no fewer clusters than its `children`;
/// its error is the pass's — the solve's, the copies its open border welded, its faces across a
/// mirror — and the parts it removed.
fn finish(
    input: &GroupReductionInput,
    local: Local,
    error: f64,
    relocked: bool,
    children: usize,
    base: u32,
) -> Result<Option<Solved>> {
    let clusters = cluster_triangles(&local.positions, &local.indices, DAG_CLUSTER_TRIANGLES)?;
    if clusters.len() >= children {
        return Ok(None);
    }
    let (source, kept) = (local.source, &local.indices);
    let vanished =
        vanished::vanished_error(source, kept, &local.positions, &local.weld, &local.extents);
    let global = |cluster: Vec<u32>| cluster.into_iter().map(|v| local.global(v, base)).collect();
    Ok(Some(Solved {
        error: error.max(vanished),
        clusters: clusters.into_iter().map(global).collect(),
        placed: local.placed(input, base),
        relocked,
    }))
}
