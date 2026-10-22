//! Virtualized-geometry cluster DAG.
//!
//! Level 0 is a partition of the source triangles' graph into small clusters. Every level after
//! that groups 8 to 32 neighbouring clusters, simplifies the merged group with its border locked,
//! and re-splits the result into clusters of the same size. Each cluster therefore carries two
//! monotone quantities: `lod_error`, the error of the group that produced it, and `parent_error`,
//! the error of the group that replaces it. A flat runtime cut `parent_error > t >= lod_error`
//! then covers the surface exactly once.
//!
//! Indices point at the source vertices, then at the vertices a reduction placed (`grown.rs`).
//! Before anything, the source is read as a mesh build reads it: each vertex built, a triangle
//! two of whose corners meet dropped, every corner welded to the first vertex at its position
//! that matches it within the build's tolerances, every value held within its range and
//! corrected as a solve corrects it (`build.rs`, `input.rs`). Each cluster's edges count the
//! edges of other clusters they meet, and a group locks what is left of them (`clusters.rs`,
//! `border.rs`). Normals, stored tangents, every texture set and the colour count in the
//! simplification error (`attributes.rs`), and the cook refuses a DAG whose error drops from a
//! cluster to its parent (`quality.rs`). Once built, a mesh may have its finest detail cut away
//! (`trim.rs`).
//!
//! **Order.** Each cluster has an identity (`identity.rs`): a level-0 cluster its range of the
//! partition, a coarser one the hash of the group that made it and its range of that group's
//! re-split. Every level's new clusters are laid in the order of their identities, a level of one
//! group excepted, which lays them in the order its reduction made them, and a cluster's
//! neighbours follow that order, so the groups never depend on which reduction ends first.
use crate::simplify::SolveRules;
use crate::support::perf::{Phase, Timer};
use crate::{invalid, CompilerError, Result};
use rayon::prelude::*;
use trillion3d_page_codec::hash::{word_map, WordMap};

/// Triangles per cluster. Matches the page budget used by the exact path.
pub const DAG_CLUSTER_TRIANGLES: usize = 128;
/// Vertex limit of an encoded cluster. The partition never reads it: a cluster whose strips lay
/// more vertices is halved once every level is built (`clusters::constrain_wide`).
pub const DAG_CLUSTER_VERTICES: usize = 256;
/// Fewest and most clusters a group holds (`groups::group_clusters`), short of its level's only
/// group; the DAG warnings and the stall report read them.
pub const DAG_GROUP_MIN: usize = 8;
pub const DAG_GROUP_MAX: usize = 32;

/// What the `simplification` option asks of the build: a mode, not a speed preference. It says
/// whether the DAG may carry, above its exact clusters, surface the source does not contain.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DagStrategy {
    /// `none`: level 0 only, an exact partition of the source's triangles. No group is reduced and
    /// no cluster replaced: each stays a root.
    ExactClusters,
    /// `qem-endpoints`: coarse levels, each group simplified by our QEM simplifier
    /// (Garland & Heckbert 1997, `simplify/region/collapse.rs`), its shared positions locked.
    QemEndpoints,
}
impl DagStrategy {
    /// The strategy the option names. Any other spelling is refused by the options' validation:
    /// only `none` keeps the build to its exact clusters.
    pub fn named(option: &str) -> Self {
        if option == "none" {
            Self::ExactClusters
        } else {
            Self::QemEndpoints
        }
    }
}

/// What a build is told: whether coarse levels exist (`DagStrategy`), the rules every solve of its
/// groups keeps (`SolveRules`), and whether a triangle two of whose corners lie within
/// `simplify::NEAR_POINTS` of each other is dropped before anything (`drop_near_collapsed`, the
/// default `DEFAULT_DROP_NEAR_COLLAPSED`), or only one two of whose corners are one point, and how
/// the source is read — its frames rebuilt, its skinned weld (`input`, `InputRules`); the defaults
/// for a strategy alone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DagSettings {
    pub strategy: DagStrategy,
    pub rules: SolveRules,
    pub drop_near_collapsed: bool,
    pub input: InputRules,
}
impl From<DagStrategy> for DagSettings {
    fn from(strategy: DagStrategy) -> Self {
        Self {
            strategy,
            rules: SolveRules::default(),
            drop_near_collapsed: crate::DEFAULT_DROP_NEAR_COLLAPSED,
            input: InputRules::default(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct DagCluster {
    /// Triangle list in the source vertex buffer, three indices per triangle.
    pub indices: Vec<u32>,
    pub level: usize,
    /// Object-space error of the simplification that produced this cluster. Zero at level 0, and on
    /// a leaf the trim left at a coarser level (`trim.rs`).
    pub lod_error: f64,
    /// Object-space error of the group that replaces this cluster. Infinite for a root.
    pub parent_error: f64,
    /// The ball `lod_error` is projected through: at level 0 the ball of the cluster's vertices,
    /// above it the ball of the producing group's children's balls (`bounds::points_ball`,
    /// `bounds::balls_ball`), so it nests and the cut is monotone. It bounds no vertex of a coarse
    /// cluster: what a page draws is bounded by its box (`DagCluster::drawn_box`), which the
    /// culling reads.
    pub sphere: [f64; 4],
    /// The box of the cluster it is half of, when the encoder halved one (`clusters::
    /// constrain_wide`): both halves draw in it. `None` for a whole cluster.
    pub whole_box: Option<([f64; 3], [f64; 3])>,
    /// Bounds of the group that replaces this cluster, used to project `parent_error`.
    pub parent_sphere: [f64; 4],
    /// Earliest source triangle this cluster descends from. Keeps a transparent draw order close to
    /// the source order, which spatial clustering would otherwise scramble.
    pub source_rank: u32,
    /// Group that replaces this cluster, `None` for a root. The runtime swaps a whole group at once.
    pub group: Option<usize>,
    /// Group whose simplification produced this cluster, `None` at level 0 and on a trimmed leaf
    /// (`trim.rs`), whose finer clusters are gone. Coarsening a group means
    /// coarsening every group that produced its children, so the runtime needs both links.
    pub source: Option<usize>,
}
impl DagCluster {
    pub fn triangles(&self) -> usize {
        self.indices.len() / 3
    }
    pub fn is_root(&self) -> bool {
        !self.parent_error.is_finite()
    }
}

/// Appends another DAG's `clusters` and `groups`, their vertices from `vertex_base`, after those
/// `into` holds: each cluster's vertices, group and source and each group's children and outputs
/// renumbered after them. The world splices its actors by it.
pub(crate) fn append_dag(
    (all_clusters, all_groups): (&mut Vec<DagCluster>, &mut Vec<DagGroup>),
    (clusters, groups): (Vec<DagCluster>, Vec<DagGroup>),
    vertex_base: u32,
) {
    let (cluster_base, group_base) = (all_clusters.len(), all_groups.len());
    all_clusters.extend(clusters.into_iter().map(|mut cluster| {
        cluster.indices.iter_mut().for_each(|v| *v += vertex_base);
        cluster.group = cluster.group.map(|g| g + group_base);
        cluster.source = cluster.source.map(|g| g + group_base);
        cluster
    }));
    all_groups.extend(groups.into_iter().map(|mut group| {
        group.children.iter_mut().for_each(|c| *c += cluster_base);
        group.outputs.iter_mut().for_each(|c| *c += cluster_base);
        group
    }));
}

/// One reduction of the DAG, kept so the runtime can swap a whole group at once.
///
/// `children` is the fine representation of the group's surface, `outputs` the coarse one its
/// simplification produced. Either one covers the group exactly, never both, so a runtime that
/// cannot show every child can fall back to the outputs without drawing twice. A stalled group
/// (`DagStall`) has no outputs: past its error its surface is drawn by nothing — unless every group
/// of its level stalled, which keeps no group at all, its children the DAG's roots.
#[derive(Clone, Debug)]
pub struct DagGroup {
    pub level: usize,
    pub error: f64,
    pub sphere: [f64; 4],
    pub children: Vec<usize>,
    pub outputs: Vec<usize>,
}

/// The area of the triangles of `clusters` over `positions`: each cluster's, measured in single
/// precision (`simplify::region::surface_area`), summed in the order given. The one summation of a
/// region's area, which its frame is set by (`simplify/region.rs`): its order is part of what a
/// build writes.
pub(crate) fn clusters_area<'a>(
    positions: &[f32],
    clusters: impl IntoIterator<Item = &'a DagCluster>,
) -> f32 {
    (clusters.into_iter()).fold(0.0_f32, |sum, cluster| {
        sum + crate::simplify::region::surface_area(positions, &cluster.indices)
    })
}

pub(crate) mod assembly;
pub(crate) mod attributes;
mod border;
pub(crate) mod bounds;
mod build;
pub(crate) mod clusters;
mod diagnosis;
pub(crate) mod groups;
mod grown;
mod identity;
mod input;
mod levels;
mod placed;
pub(crate) mod quality;
pub(crate) mod reduce;
mod shaping;
mod solved;
mod tally;
#[cfg(test)]
mod tests;
mod trim;
mod welds;

pub use attributes::DagAttributes;
pub(crate) use build::laid_source;
pub use build::{build_dag, DagBuild};
use clusters::*;
use groups::*;
pub use grown::Grown;
pub(crate) use input::{alpha_byte, srgb_byte};
pub use input::{InputRules, SkinnedWeld};
use reduce::*;
pub(crate) use shaping::MeshShaping;
pub use tally::{DagStall, GroupOutcome, GroupTally, StallCause};
pub use trim::{cut_finest, Trim};
pub(crate) use trim::{find_cut, relative_size};
use welds::GroupReductionInput;
