//! Seam-locked groups coarsen with solved vertices (Hoppe 1999; docs/COMPILER.md).
//!
//! A group the diagnosis names `seam-locked` (`diagnosis.rs`) is retried with the solve
//! (`qem_solve`): its locks kept, its seams unprotected, each surviving position moved to the
//! minimum of its quadric and each of its copies given a texture coordinate and a normal of its
//! own. The vertices it writes are placed after the primitive's (`placed.rs`, `grown.rs`); every
//! other group keeps the endpoint reduction. A texture set weighs the surface length one unit of
//! it spans in the group (`charts::densities`), normals keep `attributes::NORMAL_WEIGHT`.
//!
//! A face across two texture islands is charged its longest edge (`charts::folded_span`), and the
//! error is measured on the solve's own arrays, its placed vertices included, as every reduction's
//! is (`measured::step_error`: the removed parts, the Hausdorff distance, the texture deviation). The
//! retries are the endpoint reduction's (`retries.rs`), but a face no longer than the group's
//! error, under a pixel wherever its level is drawn, is not locked for being lit from behind: on a
//! group the solve alone frees, that stalled it again (Sponza: four groups of five).
use super::border::required_locks;
use super::charts::{densities, folded_span, longest_edge, open_border_welded, weighted};
use super::grown::Placed;
use super::placed::Local;
use super::quality::backlit_corners;
use super::stopped::Stop;
use super::retries::{with_lock_retries, Pass};
use super::*;
use crate::qem::solve::Region;
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
/// (`diagnosis::cause`), and when seam-locked retried with the solve.
pub(super) fn stalled(
    input: &GroupReductionInput,
    live: &[u32],
    children: usize,
    stop: Stop,
    child_error: f64,
) -> Result<std::result::Result<Solved, GroupOutcome>> {
    let cause = diagnosis::cause(input, live, children, stop)?;
    let seam_locked = matches!(cause, StallCause::SeamLocked);
    let solved = if seam_locked {
        attempt(input, live, children, child_error)?
    } else {
        None
    };
    Ok(solved.ok_or_else(|| diagnosis::outcome(cause, input, live)))
}

/// Reduces the seam-locked group `live` with the solve; `None` when it yields no fewer clusters
/// than its `children`, or loses a lock on every retry. Its error is the pass's — the solve's, the
/// copies its open border welded, its faces across two islands — raised by `measured::step_error`
/// over the region and the vertices it placed, and `child_error`.
fn attempt(
    input: &GroupReductionInput,
    live: &[u32],
    children: usize,
    child_error: f64,
) -> Result<Option<Solved>> {
    let base = (input.positions.len() / 3) as u32;
    let required = required_locks(live, input.locks, input.weld);
    let densities = densities(input.positions, &input.attributes.uv_sets(), live);
    let (live, weld_error) = &open_border_welded(input, live, &densities);
    let weighted = weighted(input, live, &densities);
    let region = Region::of(input.positions, &weighted, live)?;
    let pass = |extra: &[u32]| -> Result<std::result::Result<Solve, Stop>> {
        let locked = |v: u32| {
            input.locks[v as usize] || extra.binary_search(&input.weld[v as usize]).is_ok()
        };
        let Some(solved) = region.solve(live.len() / 6, &locked) else {
            return Ok(Err(Stop::NoCollapse));
        };
        let error = solved.error_object.max(*weld_error);
        let local = Local::of(input, solved);
        let (indices, positions) = (&local.indices, &local.positions);
        let span = folded_span(indices, positions, input.islands, |v| local.from(v));
        Ok(Ok(Solve {
            error: error.max(span),
            local,
            input,
        }))
    };
    let Ok((Solve { local, error, .. }, relocked)) =
        with_lock_retries(live, &required, input.weld, pass)?
    else {
        return Ok(None);
    };
    let clusters = cluster_triangles(&local.positions, &local.indices, DAG_CLUSTER_TRIANGLES)?;
    if clusters.len() >= children {
        return Ok(None);
    }
    let placed = local.placed(input, base);
    let (weld_seam, uv_sets) = local.measured(input, &placed);
    let surface = measured::Surface {
        positions: &local.positions,
        weld: &local.weld,
        weld_seam: &weld_seam,
        extents: &local.extents,
        uv_sets: uv_sets.iter().map(Vec::as_slice).collect(),
    };
    let error = measured::step_error(&surface, local.source, &local.indices, error, child_error);
    let global = |cluster: Vec<u32>| cluster.into_iter().map(|v| local.global(v, base)).collect();
    Ok(Some(Solved {
        error,
        clusters: clusters.into_iter().map(global).collect(),
        placed,
        relocked,
    }))
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
