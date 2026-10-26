//! The displacement baked into a mesh's triangles. A mesh that names height maps (`meshBuild`'s
//! `displacementMaps`, `settings.rs`) and a `trimmedError` above 0 is tessellated and displaced
//! along its normals before its clusters are built (`bake.rs`) — all its triangle primitives as one
//! soup, each triangle by the map of its primitive's rank —: each triangle is split where the
//! displacement strays from what its corners' displacements interpolate (`tessellate.rs`, `search.rs`, `refine.rs`), over a soup of triangles whose adjacency
//! follows their positions (`mesh.rs`, `edit.rs`), the displacement read from a height image
//! (`load.rs`, `map.rs`) at the interpolated texture coordinates, its error bounded by affine
//! arithmetic over each sub-triangle (`policy.rs`, `affine.rs`). The coarser levels of the DAG are
//! then simplified from the displaced mesh down to the error asked. What reads the mesh's triangles
//! reads the baked ones: the DAG, the collider cooked from it, the merged layers of the HLOD, and the
//! voxels, sampled from the baked mesh its seed keeps (`VoxelSeed::traced`).
//!
//! The height images are read when the first primitive that bakes with them asks (`Bakes`), once
//! each however many maps name them, and the memory a bake holds is charged by the plan
//! (`compiler/primitive/cost.rs`, `bytes.rs`).
//!
//! A mesh that names no map, or that deforms — a skin, a morph, a soft body —, is built as it was,
//! its product unchanged.
pub(crate) mod abi;
mod affine;
mod bake;
mod bytes;
mod edit;
mod hierarchy;
mod load;
mod map;
mod mesh;
mod policy;
mod refine;
mod search;
mod settings;
mod tessellate;
#[cfg(test)]
mod tests;

pub(crate) use bake::{bake_mesh, Baked, Piece};
pub(crate) use bytes::{baked_bytes, hashed, most_after, soup_bytes};
pub(crate) use load::Bakes;
pub(crate) use settings::{DisplacementSettings, EdgeSplit, MapSpec};
pub(crate) use tessellate::MAX_TRIANGLES;
