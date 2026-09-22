//! Virtualized-geometry cluster DAG.
//!
//! Level 0 is a spatial partition of the source triangles into small clusters. Every level after
//! that groups 8 to 32 neighbouring clusters, simplifies the merged group with its border locked,
//! and re-splits the result into clusters of the same size. Each cluster therefore carries two
//! monotone quantities: `lod_error`, the error of the group that produced it, and `parent_error`,
//! the error of the group that replaces it. A flat runtime cut `parent_error > t >= lod_error`
//! then covers the surface exactly once.
//!
//! Two simplifiers, chosen by `DagStrategy`, both placing their collapses on the region's own
//! vertices: coarse indices point at source vertices, which keeps every attribute where the
//! source put it. `QemEndpoints` ranks the collapses on the distance to the surface alone.
//! `QemAttributes` adds normals, texture coordinates and colours to that ranking, each weighed
//! into object units by `attributes.rs`, so a collapse that would slide a texture costs what
//! the slide is worth and is taken later.
use crate::geometry_page::Attribute;
use crate::perf::{Phase, Timer};
use crate::qem::{compact_region, simplify_with_locked_vertices};
use crate::{invalid, Result};
use rayon::prelude::*;
use std::collections::HashMap;

/// Triangles per cluster. Matches the page budget used by the exact path.
pub const DAG_CLUSTER_TRIANGLES: usize = 128;
/// meshopt caps a meshlet at 255 vertices; a 128 triangle cluster never needs more.
pub const DAG_CLUSTER_VERTICES: usize = 255;
pub const DAG_GROUP_MIN: usize = 8;
pub const DAG_GROUP_MAX: usize = 32;
/// 2x reduction per level bounds the depth of a 2^24 triangle mesh.
pub const DAG_MAX_LEVELS: usize = 32;
/// meshopt's relative error ceiling. Large enough to always reach the triangle target.
const SIMPLIFY_ERROR_CEILING: f32 = 1.0;

/// What the `simplification` option requests from the build. A mode, not a speed preference:
/// it says whether the DAG may carry, above the exact clusters, a surface the source does not
/// contain, and which vertices that surface is made of.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DagStrategy {
    /// `none`: level zero only, exact partition of source triangles. No group
    /// reduced, no cluster replaced, each stays root.
    ExactClusters,
    /// `qem-endpoints`: coarse levels, each group reduced by a positional QEM whose collapses
    /// land on existing vertices; the border is locked.
    QemEndpoints,
    /// `qem-attributes`: coarse levels, each group reduced by an attribute-aware QEM whose
    /// collapses also land on existing vertices; the border is locked and a texture seam only
    /// slides along itself.
    QemAttributes,
}
impl DagStrategy {
    /// The option values, in the order the CLI documents them.
    pub const NAMES: [&str; 3] = ["none", "qem-endpoints", "qem-attributes"];
    /// Strategy named by the option; `None` for a spelling the option validation refuses.
    pub fn named(option: &str) -> Option<Self> {
        match option {
            "none" => Some(Self::ExactClusters),
            "qem-endpoints" => Some(Self::QemEndpoints),
            "qem-attributes" => Some(Self::QemAttributes),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct DagCluster {
    /// Triangle list in the source vertex buffer, three indices per triangle, at every level.
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
    /// One cluster of the group that replaces this one. `None` for a root. Builder bookkeeping only.
    pub replacement: Option<usize>,
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

/// The vertex buffer of a primitive, as the DAG reads it at every level: positions are three
/// floats per vertex, and each attribute holds `width` floats per vertex, in the same order.
pub struct DagVertices<'a> {
    pub positions: &'a [f32],
    pub attributes: &'a [Attribute],
}

/// Everything a build publishes: the clusters, the groups that replace them, and the tally of
/// every level.
#[derive(Debug)]
pub struct DagBuild {
    pub clusters: Vec<DagCluster>,
    pub groups: Vec<DagGroup>,
    pub tallies: Vec<GroupTally>,
}

// ---------------------------------------------------------------- geometry helpers

struct GroupReduction {
    error: f64,
    sphere: [f64; 4],
    clusters: Vec<Vec<u32>>,
    source_rank: u32,
    /// Reduction had to weld indices by position (`reduce.rs`).
    welded: bool,
    /// Reduction had to lock additional triangles to preserve border.
    relocked: bool,
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
    strategy: DagStrategy,
    positions: &'a [f32],
    attributes: &'a [Attribute],
    locks: &'a [bool],
    /// Simplifier flags per source vertex, `PROTECT` on a texture seam and `LOCK` on a mirror
    /// edge, which `QemAttributes` adds to the level's own locks (`protect.rs`).
    vertex_flags: &'a [u8],
    /// Canonical vertex by position: locks, borders, adjacency.
    weld: &'a [u32],
    /// Canonical vertex by (position, uv): the weld a stalled reduction falls back on.
    weld_seam: &'a [u32],
}

pub(crate) mod attributes;
pub(crate) mod border;
pub(crate) mod bounds;
mod build;
pub(crate) mod clusters;
mod culling;
pub(crate) mod groups;
mod protect;
pub(crate) mod reduce;
mod reduce_attributes;
mod tally;
#[cfg(test)]
pub(crate) mod tests;
pub(crate) mod weld;

use bounds::*;
pub use build::build_dag_tallied;
use clusters::*;
pub use culling::{build_culling_bvh, CullingNode};
use groups::*;
use reduce::*;
pub use tally::{GroupOutcome, GroupTally};
use weld::*;
