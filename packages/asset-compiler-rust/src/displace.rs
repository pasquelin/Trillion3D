//! The displacement baked into a mesh's triangles. A mesh that names height maps (`meshBuild`'s
//! `displacementMaps`, `settings.rs`), has one triangle primitive and a `trimmedError` above 0 is
//! tessellated and displaced along its normals before its clusters are built (`bake.rs`): each
//! triangle is split where the displacement strays from what its corners' displacements
//! interpolate (`tessellate.rs`, `search.rs`, `refine.rs`), over a soup of triangles whose adjacency
//! follows their positions (`mesh.rs`, `edit.rs`), the displacement read from a height image
//! (`load.rs`, `map.rs`) at the interpolated texture coordinates, its error bounded by affine
//! arithmetic over each sub-triangle (`policy.rs`, `affine.rs`). The coarser levels of the DAG are
//! then simplified from the displaced mesh down to the error asked.
//!
//! A mesh that names no map, or that deforms — a skin, a morph, a soft body —, is built as it was,
//! its product unchanged.
pub(crate) mod abi;
mod affine;
mod bake;
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

pub(crate) use bake::{bake, Baked};
pub(crate) use load::{load_bakes, Bake};
pub(crate) use settings::{DisplacementSettings, EdgeSplit, MapSpec};
