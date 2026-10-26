//! The volumetric lightmap: precomputed indirect light stored in a sparse grid of bricks.
//!
//! The world is cut by an indirection volume, one texel a brick of the finest level; each texel
//! names a brick of the brick atlas and how many finest bricks that brick spans (a coarse brick
//! covers a whole block of texels). Every brick holds `BrickSize`³ lighting samples of the
//! third-order spherical harmonics, plus one row of padding on its three upper faces so a
//! trilinear read at a brick's edge never leaves it: a padded brick is `BrickSize + 1` texels
//! wide. A sample is the ambient (the zeroth coefficient, as a packed float colour), six layers of
//! the higher coefficients — each divided by the ambient and by its basis function's scale, then
//! mapped from [-1, 1] to [0, 1] —, the sky's bent normal (its length is the sky's visibility;
//! optional) and the stationary sun's shadowing.
//!
//! `format.rs` is the file and its numbers, `writer.rs` lays the layers out in it, `bake.rs` fills
//! the layers: the indirect light of the scene, traced as the reference's GPU bake traces it.
//! The runtime reads the file in `sdk-core/src/lighting/volumetricLightmapFile.ts`.
pub mod bake;
pub mod format;
mod stage;
pub mod writer;

pub use format::*;
pub(crate) use stage::{stage_volumetric_lightmap, LightmapInputs};
pub use writer::{encode, write, LightmapCell, VolumetricLightmapLayers};
