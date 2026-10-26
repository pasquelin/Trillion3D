//! Group reduction: the one reduction (`solved.rs`) and, when it stalls, the diagnosis
//! (`diagnosis.rs`).
//!
//! The group's corners first point at their exact copy (`attributes::weld_exact`): vertices equal
//! in every float the build carries are one vertex. Its border (`border.rs`) locks the ends of the
//! edges it shares with other groups. The simplifier (`simplify/region/collapse.rs`) locks no
//! texture seam nor hard edge: the vertices of a position stay apart as long as their attributes
//! differ, each wedge solving its own at the merged position, the seam held by its edge quadric.
use super::border::Border;
use super::solved::attempt;
use super::*;

/// A group's reduction: its error and sphere, its output clusters with their external edges
/// (`clusters.rs`) and identities (`identity.rs`) — none when no target size re-split it
/// (`solved.rs`) —, its earliest source triangle, the vertices it placed, and, stalled, why.
pub(super) struct GroupReduction {
    pub error: f64,
    pub sphere: [f64; 4],
    pub clusters: Vec<Vec<u32>>,
    pub outer: Vec<Vec<u8>>,
    pub identities: Vec<u64>,
    pub source_rank: u32,
    /// The vertices the reduction placed (`solved.rs`).
    pub placed: super::grown::Placed,
    pub stall: Option<GroupOutcome>,
}

/// Reduces the group of `children`, whose identity is `identity` (`identity::of_group`) and whose
/// external edges `outer` counts (`clusters.rs`), one list per child; a group no target size
/// re-splits keeps its error and makes no cluster, its stall diagnosed.
pub(super) fn reduce_group(
    input: &GroupReductionInput,
    children: &[&DagCluster],
    outer: &[&[u8]],
    identity: u64,
) -> Result<GroupReduction> {
    let mut spheres = Vec::with_capacity(children.len());
    let mut child_error = 0.0_f64;
    let mut source_rank = NO_SOURCE_RANK;
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
    let area = clusters_area(input.positions, children.iter().copied());
    let border = {
        let _t = Timer::new(Phase::Locks);
        Border::of(input.positions, input.weld, &corners, outer)
    };
    let solved = attempt(
        input,
        (&corners, &border),
        (parents, area),
        (child_error, identity),
    )?;
    let stall = (solved.clusters.is_empty())
        .then(|| diagnosis::outcome(StallCause::Unreducible, input, (&corners, &border)));
    // The group's sphere is the ball of its children's alone — a level-0 cluster's ball of its
    // vertices, every coarser one its producing group's —, so each parent holds its children and
    // the projected error never drops along the cut. It projects the error only: what a page
    // draws is bounded by its box over the drawn vertices (`DagCluster::drawn_box`), which the
    // culling reads.
    let sphere = bounds::balls_ball(&spheres);
    Ok(GroupReduction {
        error: solved.error,
        sphere,
        clusters: solved.clusters,
        outer: solved.outer,
        identities: solved.identities,
        source_rank,
        placed: solved.placed,
        stall,
    })
}
