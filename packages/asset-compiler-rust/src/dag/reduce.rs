//! Group reduction: the one reduction (`solved.rs`) and, when it stalls, the diagnosis
//! (`diagnosis.rs`).
//!
//! The group's corners first point at their exact copy (`attributes::weld_exact`): vertices equal
//! in every float the pages store are one vertex. The simplifier (`qem_simplifier.rs`) locks no
//! texture seam nor hard edge: the vertices of a position stay apart as long as their attributes
//! differ, each wedge solving its own at the merged position, the seam held by its edge quadric.
use super::solved::attempt;
use super::*;
use crate::qem::solve::surface_area;
use trillion3d_page_codec::min_ball::ball_of_balls;

pub(super) fn reduce_group(
    input: &GroupReductionInput,
    children: &[&DagCluster],
) -> Result<std::result::Result<GroupReduction, GroupOutcome>> {
    let mut spheres = Vec::with_capacity(children.len());
    let mut child_error = 0.0_f64;
    let mut source_rank = u32::MAX;
    let mut child_triangles = 0usize;
    for child in children {
        spheres.push(child.sphere);
        child_error = child_error.max(child.lod_error);
        source_rank = source_rank.min(child.source_rank);
        child_triangles += child.triangles();
    }
    // A level halves its triangles: the parents are the children's triangles over two full
    // clusters, rounded up.
    let parents = child_triangles.div_ceil(DAG_CLUSTER_TRIANGLES * 2);
    let mut own: WordMap<u32, u32> = WordMap::default();
    let corners: Vec<u32> = (children.iter().flat_map(|c| c.indices.iter()))
        .map(|&v| *own.entry(input.exact[v as usize]).or_insert(v))
        .collect();
    // The area each child measures of its own triangles, summed: the region's frame.
    let area = (children.iter()).fold(0.0_f32, |sum, c| {
        sum + surface_area(input.positions, &c.indices)
    });
    let Some(solved) = attempt(input, &corners, (parents, area), child_error)? else {
        return Ok(Err(diagnosis::outcome(
            StallCause::Unreducible,
            input,
            &corners,
        )));
    };
    if !solved.error.is_finite() {
        return Ok(Err(diagnosis::outcome(
            StallCause::UnusableError,
            input,
            &corners,
        )));
    }
    // The group's sphere is the ball of its children's alone — a level-0 cluster's smallest ball
    // of its vertices, every coarser one its producing group's —, so each parent holds its
    // children and the projected error never drops along the cut. It projects the error only:
    // what a page draws is bounded by its box over the drawn vertices (`bounds::cluster_bounds`),
    // which the culling reads.
    let sphere = ball_of_balls(&spheres);
    Ok(Ok(GroupReduction {
        error: solved.error,
        sphere,
        clusters: solved.clusters,
        source_rank,
        placed: solved.placed,
    }))
}
