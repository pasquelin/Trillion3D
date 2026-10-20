//! Voxel far field: the coarsest levels of a primitive's DAG as sparse 4³ bricks.
//!
//! Far away a tower's windows are thinner than a pixel: its simplified triangles drop them at
//! random and a card shimmers. A DAG group is drawn as voxels when their error is below its
//! triangles' error at that level — voxels average the thin parts the simplifier drops —, and every
//! group above one drawn so is too. A voxel's error is `ERROR_PER_SIZE` times its side: when the
//! cut's error spans `DEFAULT_PIXEL_ERROR` pixels, a voxel spans one.
//!
//! A group's voxels stand for the level-0 triangles it covers (`seed.rs`). Each voxel those
//! triangles overlap (`raster.rs`) is crossed by rays along its three axes against the primitive's
//! level-0 triangles, each face averaged by the surface sampler (`surface_trace::texel`):
//! coverage, prefiltered base colour and ORM, mean normal and its length — the normal spread
//! Toksvig's filter reads —, and the plane that best fits the hits, the contour of Laine and
//! Karras's sparse voxel octrees, which keeps a silhouette and its depth smooth where a cube would
//! step (`sample.rs`). A voxel is solid once the coverage its dropped neighbours hand over, the
//! least covered first, brings it to half (`solid.rs`). Solid voxels are packed in 4³ bricks,
//! each with the joint most of its triangles follow (`bricks.rs`); the stage writes every group's
//! in one product (`stage.rs`). Glass is read opaque. No runtime reads them yet: the cards stay.
mod axes;
mod bricks;
mod raster;
mod sample;
mod seed;
mod solid;
mod stage;

pub(crate) use seed::{ShapePreservation, VoxelSeed};
pub(crate) use stage::{stage_voxels, VoxelInputs};

/// Format of `voxels.bin` and of the manifest's `voxels` section (`stage.rs` lays it out).
pub(crate) const VOXEL_VERSION: u32 = 2;

/// The product holding every voxel group.
pub(crate) const VOXEL_FILE: &str = "voxels.bin";

/// A voxel group's error over its voxels' side: the cut's pixels for one voxel a pixel wide.
const ERROR_PER_SIZE: f64 = crate::shared_math::abi::DEFAULT_PIXEL_ERROR;
