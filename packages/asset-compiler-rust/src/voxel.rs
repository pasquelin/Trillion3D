//! Voxel far field: the coarsest levels of a primitive's DAG as sparse 4³ bricks.
//!
//! Far away a tower's windows are thinner than a pixel: its simplified triangles drop them at
//! random and a card shimmers. A DAG group is drawn as voxels when their error is below its
//! triangles' error at that level — voxels average the thin parts the simplifier drops —, and every
//! group above one drawn so is too. A voxel's error is `ERROR_PER_SIZE` times its side: when the
//! cut's error spans `DEFAULT_PIXEL_ERROR` pixels, a voxel spans one.
//!
//! A group's voxels stand for the level-0 triangles it covers (`seed.rs`). Each voxel those
//! triangles overlap (`raster.rs`) is crossed by 64 rays of every direction — the mesh's build
//! names their count and how they run (`sampling.rs`) — against the primitive's level-0
//! triangles, a cut texel letting a ray through: coverage, prefiltered base colour and ORM, mean
//! normal and its length — the normal spread Toksvig's filter reads (`sample.rs`). The least
//! covered voxels are dropped, their coverage handed to their neighbours, until no more are left
//! than the coverage sums to (`solid.rs`). Solid voxels are packed in 4³ bricks, each with the
//! joint most of its triangles follow (`bricks.rs`); the stage writes every group's in one
//! product (`stage.rs`). Glass is read opaque. The engine draws each brick as its box and traces
//! its voxels pixel by pixel (`sdk-browser/src/visibility/shader/voxelWgsl.ts`).
mod bricks;
mod levels;
mod page;
mod raster;
mod rays;
mod sample;
mod sampling;
mod seed;
mod solid;
mod stage;

pub(crate) use levels::{cell_levels, VoxelLevel};
pub(crate) use page::voxel_dag;
pub(crate) use raster::cells_within as triangle_cells;
pub(crate) use sampling::VoxelSampling;
pub(crate) use seed::{ShapePreservation, VoxelSeed};
pub(crate) use stage::{stage_voxels, VoxelInputs};
pub(crate) use trillion3d_page_codec::voxel::VoxelPage;

/// Format of `voxels.bin` and of the manifest's `voxels` section (`stage.rs` lays it out): 4 since a
/// voxel's record is twelve bytes — no material, which the runtime never read, and a coverage only
/// where the build keeps it as opacity (`voxelOpacity`, byte 7: the bytes of a build that does not
/// are the same) — and a page's brick holds the rank of its first voxel
/// (`trillion3d_page_codec::voxel`).
pub(crate) const VOXEL_VERSION: u32 = 4;

/// The product holding every voxel group.
pub(crate) const VOXEL_FILE: &str = "voxels.bin";

/// A voxel group's error over its voxels' side: the cut's pixels for one voxel a pixel wide.
const ERROR_PER_SIZE: f64 = crate::shared_math::abi::DEFAULT_PIXEL_ERROR;
