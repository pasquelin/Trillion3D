//! Virtualized-geometry cluster DAG.
//!
//! Level 0 is a spatial partition of the source triangles into small clusters. Every level after
//! that groups 8 to 32 neighbouring clusters, simplifies the merged group with its border locked,
//! and re-splits the result into clusters of the same size. Each cluster therefore carries two
//! monotone quantities: `lod_error`, the error of the group that produced it, and `parent_error`,
//! the error of the group that replaces it. A flat runtime cut `parent_error > t >= lod_error`
//! then covers the surface exactly once.
//!
//! The metric is positional only: indices keep pointing at the source vertices, so UV, normals and
//! colours survive untouched, but they do not participate in the simplification error yet.
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

/// Ce que l'option `simplification` demande à la construction. Le mode n'est pas une préférence de
/// vitesse : il dit si le DAG a le droit de porter, au-dessus des clusters exacts, une surface que
/// la source ne contient pas.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DagStrategy {
    /// `none` : le seul niveau zéro, partition exacte des triangles de la source. Aucun groupe n'est
    /// réduit, donc aucun cluster n'est remplacé et chacun reste une racine.
    ExactClusters,
    /// `qem-endpoints` : les niveaux grossiers, chaque groupe réduit par QEM bord verrouillé.
    QemEndpoints,
}
impl DagStrategy {
    /// La stratégie que nomme l'option. Toute autre orthographe est déjà refusée par la validation
    /// des options : seul `none` retient la construction.
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

// ---------------------------------------------------------------- geometry helpers

struct GroupReduction {
    error: f64,
    sphere: [f64; 4],
    clusters: Vec<Vec<u32>>,
    source_rank: u32,
    /// La réduction a dû souder les indices par position (`reduce.rs`).
    welded: bool,
    /// La réduction a dû verrouiller des triangles en plus pour garder son bord.
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
    positions: &'a [f32],
    locks: &'a [bool],
    /// Sommet canonique par position : verrous, bords, adjacence.
    weld: &'a [u32],
    /// Sommet canonique par (position, uv) : la soudure de repli de la réduction.
    weld_seam: &'a [u32],
}
pub const CULLING_BRANCHING: usize = 8;
pub const CULLING_LEAF: usize = 8;
/// One node of the per-primitive culling hierarchy.
///
/// `sphere` encloses every `parent_sphere` of the subtree and `max_parent_error` is the largest
/// `parent_error` in it, so a single projection bounds the whole subtree from above: when that bound
/// already fits the pixel budget, no cluster below can be selected and the subtree is skipped.
#[derive(Clone, Debug)]
pub struct CullingNode {
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub sphere: [f64; 4],
    pub max_parent_error: f64,
    pub first_child: usize,
    pub child_count: usize,
    pub first_cluster: usize,
    pub cluster_count: usize,
}
impl Default for CullingNode {
    fn default() -> Self {
        Self {
            min: [0.0; 3],
            max: [0.0; 3],
            sphere: [0.0; 4],
            max_parent_error: 0.0,
            first_child: 0,
            child_count: 0,
            first_cluster: 0,
            cluster_count: 0,
        }
    }
}

pub(crate) mod border;
pub(crate) mod bounds;
mod build;
pub(crate) mod clusters;
mod culling;
pub(crate) mod groups;
pub(crate) mod reduce;
mod tally;
#[cfg(test)]
mod tests;

use bounds::*;
pub use build::build_dag_tallied;
use clusters::*;
pub use culling::build_culling_bvh;
use groups::*;
use reduce::*;
pub use tally::{GroupOutcome, GroupTally};
