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
//! Normals, every texture set and the colour count in the simplification error (`attributes.rs`),
//! and the cook refuses a DAG whose error drops from a cluster to its parent (`quality.rs`).
use crate::perf::{Phase, Timer};
use crate::{invalid, Result};
use rayon::prelude::*;
use trillion3d_page_codec::hash::{word_map, WordMap};

/// Triangles per cluster. Matches the page budget used by the exact path.
pub const DAG_CLUSTER_TRIANGLES: usize = 128;
/// Vertex limit of an encoded cluster. The partition never reads it: a cluster over it is halved
/// once every level is built (`clusters::constrain_wide`).
pub const DAG_CLUSTER_VERTICES: usize = 256;
/// Fewest and most clusters a group holds (`groups::group_clusters`), short of its level's only
/// group; the DAG warnings and the stall report read them.
pub const DAG_GROUP_MIN: usize = 8;
pub const DAG_GROUP_MAX: usize = 32;
/// 2x reduction per level bounds the depth of a 2^24 triangle mesh.
pub const DAG_MAX_LEVELS: usize = 32;

/// What `simplification` option requests from build. Mode not speed preference:
/// specifies whether DAG allowed to carry, above exact clusters, surface
/// source does not contain.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DagStrategy {
    /// `none`: level zero only, exact partition of source triangles. No group
    /// reduced, no cluster replaced, each stays root.
    ExactClusters,
    /// `qem-endpoints`: coarse levels, each group simplified by our QEM simplifier
    /// (Garland & Heckbert 1997, `qem_simplifier.rs`), its shared positions locked.
    QemEndpoints,
}
impl DagStrategy {
    /// Strategy named by option. Any other spelling refused by options validation:
    /// only `none` retains build.
    pub fn named(option: &str) -> Self {
        if option == "none" {
            Self::ExactClusters
        } else {
            Self::QemEndpoints
        }
    }
}

#[derive(Clone, Debug)]
pub struct DagCluster {
    /// Triangle list in the source vertex buffer, three indices per triangle.
    pub indices: Vec<u32>,
    pub level: usize,
    /// Object-space error of the simplification that produced this cluster. Zero at level 0.
    pub lod_error: f64,
    /// Object-space error of the group that replaces this cluster. Infinite for a root.
    pub parent_error: f64,
    /// Bounds of the group that produced this cluster, used to project `lod_error`.
    pub sphere: [f64; 4],
    /// Bounds of the group that replaces this cluster, used to project `parent_error`.
    pub parent_sphere: [f64; 4],
    /// Earliest source triangle this cluster descends from. Keeps a transparent draw order close to
    /// the source order, which spatial clustering would otherwise scramble.
    pub source_rank: u32,
    /// Group that replaces this cluster, `None` for a root. The runtime swaps a whole group at once.
    pub group: Option<usize>,
    /// Group whose simplification produced this cluster, `None` at level 0. Coarsening a group means
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

// ---------------------------------------------------------------- geometry helpers

struct GroupReduction {
    error: f64,
    sphere: [f64; 4],
    clusters: Vec<Vec<u32>>,
    source_rank: u32,
    /// The vertices the reduction placed (`solved.rs`).
    placed: grown::Placed,
}
/// One reduction of the DAG, kept so the runtime can swap a whole group at once.
///
/// `children` is the fine representation of the group's surface, `outputs` the coarse one its
/// simplification produced. Either one covers the group exactly, never both, so a runtime that
/// cannot show every child can fall back to the outputs without a hole and without drawing twice.
#[derive(Clone, Debug)]
pub struct DagGroup {
    pub level: usize,
    pub error: f64,
    pub sphere: [f64; 4],
    pub children: Vec<usize>,
    pub outputs: Vec<usize>,
}
struct GroupReductionInput<'a> {
    /// The level's vertex arrays: the source's, then every vertex a solved reduction placed.
    positions: &'a [f32],
    /// Every attribute the pages carry; normals and texture sets count in the error.
    attributes: DagAttributes<'a>,
    /// Those the simplifier weighs (`DagAttributes::weighted`), built once per level.
    weighted: &'a [crate::qem::Attribute<'a>],
    locks: &'a [bool],
    /// Canonical vertex by position: locks, borders, adjacency.
    weld: &'a [u32],
    /// Canonical vertex by position and every carried attribute (`attributes::weld_exact`).
    exact: &'a [u32],
    /// Canonical vertex by position and every texture set: the diagnosis's census.
    weld_seam: &'a [u32],
}
pub(crate) mod attributes;
pub(crate) mod bounds;
mod build;
pub(crate) mod clusters;
mod diagnosis;
pub(crate) mod groups;
mod grown;
mod levels;
mod placed;
pub(crate) mod quality;
pub(crate) mod reduce;
mod solved;
mod tally;
#[cfg(test)]
mod tests;
mod welds;

pub use attributes::DagAttributes;
pub use build::{build_dag, DagBuild};
use clusters::*;
use groups::*;
pub use grown::Grown;
use reduce::*;
pub use tally::{DagStall, GroupOutcome, GroupTally, StallCause};
use trillion3d_page_codec::min_ball::point_sphere;
