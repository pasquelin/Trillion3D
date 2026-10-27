//! A primitive's tree for ray tracing: a coarse cut of its cluster DAG and the tree of eight
//! children a node over the cut's triangles, what a ray tracer walks in place of the primitive's
//! clusters.
//!
//! The cut (`cut.rs`) is the DAG at an error of `FALLBACK_RELATIVE_ERROR` hundredths of the mesh's
//! size: every cluster whose error it does not exceed and whose group's it does, so the surface is
//! whole with no triangle twice. The triangles keep the rank of their cluster and their own in
//! it. A binary tree is built over them by the surface area heuristic (`bvh.rs`) and collapsed
//! into eight children a node (`wide.rs`), whose child boxes are quantised in the node's frame
//! (`nodes.rs`). The tree is built with the primitive's DAG (`primitive_tree`, `tree.rs`).
//!
//! `rayTracing.bin` (`encode.rs`) holds the trees of every primitive that has a triangle in its
//! cut and, last, the world's (`world.rs`): a tree for each HLOD actor, cut at its own error and
//! naming the cell that shows it, and the directory of them; the manifest's `rayTracing` section
//! names it.
pub(crate) mod abi;
mod bvh;
mod cut;
mod encode;
mod nodes;
mod stage;
#[cfg(test)]
mod tests;
mod tree;
mod wide;
mod word;
mod world;

pub(crate) use stage::write_ray_tracing;
pub(crate) use tree::{material_flags, primitive_tree, PrimitiveTree, Traced};
pub(crate) use world::{world_trees, WorldGate, WorldTrees};
