//! THE CULLING HIERARCHY BUILDER, one for the native compiler's primitives and world, and for the
//! cuts the world makes at run time (`wasm/culling.rs`, in the page worker): GROUP PARTS in — the
//! clusters of one group a streaming page holds, a run of consecutive cluster ranks each —, the
//! nodes the GPU descent reads out. The cluster order is the caller's, the page assignment's: a
//! leaf names its part's ranks, and nothing here moves a cluster.
//!
//! The tree is built as the reference builds it (`tree.rs`): one tree per level, whose leaves are
//! that level's parts, each a complete tree of `CULLING_FANOUT` children a node — at most one node
//! partly filled —, its parts sorted along the axis of least cost at each binary split; then the
//! roots of those trees under one root, the three coarsest beside a tree of the others. Every node
//! carries what its parent's test reads of it: its box, its LOD ball, the least own error and the
//! largest replacement error under it.
use crate::balls::balls_ball;
use trillion3d_math::geometry::aabb::aabb_of_boxes;

mod layout;
mod tree;

/// Children of an inner node.
pub const CULLING_FANOUT: usize = 4;
/// Numbers per node in the flat layout the manifest and the run-time cut carry: box, sphere,
/// replacement error ceiling (-1 over a subtree holding a root), least own error, first child,
/// child count, first cluster, cluster count.
pub const CULLING_STRIDE: usize = 16;
/// The leading numbers of a flat node that are measures — box, sphere, the two errors —; the
/// `CULLING_STRIDE - CULLING_MEASURES` after them are whole numbers: links and counts.
pub const CULLING_MEASURES: usize = 12;

/// One cluster as the hierarchy's parts are made of it: its box, its level, and the band of what
/// replaces it (`parent_error` infinite for a root, which nothing replaces).
#[derive(Clone, Copy, Debug)]
pub struct CullingCluster {
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub level: usize,
    pub parent_sphere: [f64; 4],
    pub parent_error: f64,
}

/// One leaf of the hierarchy, a GROUP PART: the clusters of one group a streaming page holds, the
/// ranks `first..first + count`, with the box of their boxes, their group's level, LOD ball and
/// replacement error (infinite for the roots, which nothing replaces), and the least of their own
/// errors — zero for a cluster no simplification made.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CullingPart {
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub level: usize,
    pub sphere: [f64; 4],
    pub min_error: f64,
    pub parent_error: f64,
    pub first: usize,
    pub count: usize,
}

/// Numbers per part record, the run-time cut's input (`wasm/culling.rs`): the box's least corner
/// then its greatest, the LOD ball, the least own error, the replacement error (infinite for a
/// root), the level, the first rank and the count.
pub const CULLING_RECORD_FLOATS: usize = 15;

/// One node of the culling hierarchy: what a parent's test reads of it.
///
/// A leaf is a part: its box, its group's LOD ball and replacement error, the least own error of
/// its clusters, and their ranks. An inner node holds the box of its children's boxes, the ball of
/// their balls (`balls_ball`), the least of their own errors and the largest of their replacement
/// errors, so one projection bounds its subtree: past the largest replacement error no cluster
/// below is needed, and under a leaf's least own error none is fine enough.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CullingNode {
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub sphere: [f64; 4],
    pub min_error: f64,
    pub max_parent_error: f64,
    pub first_child: usize,
    pub child_count: usize,
    pub first_cluster: usize,
    pub cluster_count: usize,
}

impl CullingNode {
    /// The leaf of `part`.
    fn leaf(part: &CullingPart) -> Self {
        Self {
            min: part.min,
            max: part.max,
            sphere: part.sphere,
            min_error: part.min_error,
            max_parent_error: part.parent_error,
            first_cluster: part.first,
            cluster_count: part.count,
            ..Self::default()
        }
    }

    /// The inner node over `children`, in their order: the box of their boxes, the ball of their
    /// balls, the least of their own errors, the largest of their replacement errors.
    fn over(children: &[&CullingNode]) -> Self {
        let (min, max) = aabb_of_boxes(children.iter().map(|child| (child.min, child.max)));
        let spheres: Vec<[f64; 4]> = children.iter().map(|child| child.sphere).collect();
        Self {
            min,
            max,
            sphere: balls_ball(&spheres),
            min_error: (children.iter()).fold(f64::INFINITY, |least, c| least.min(c.min_error)),
            max_parent_error: (children.iter())
                .fold(0.0, |most: f64, c| most.max(c.max_parent_error)),
            ..Self::default()
        }
    }
}

/// The hierarchy over `parts` (`tree.rs`), its nodes numbered breadth first from the root, every
/// node's children after it, side by side. No part gives one empty root, so the descent still has
/// a root to start from; one part a root over its one leaf.
pub fn build_culling_bvh(parts: &[CullingPart]) -> Vec<CullingNode> {
    tree::nodes(parts)
}

#[cfg(test)]
pub(crate) mod families;
#[cfg(test)]
mod tests;
