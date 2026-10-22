//! A mesh's signed distance field: the distance from a point near it to its surface, negative
//! inside, sampled in bricks of 8³ voxels and stored in three mips, for the distance-field
//! occlusion of the sky light and the software ray tracing.
//!
//! The field is built from the mesh's level-0 triangles, in the reference's unit, the centimetre
//! (`DISTANCE_FIELD_UNITS_PER_METRE`), exactly as its mesh build does:
//! - the box of the mesh, at least one unit of half-extent, is the field's `bounds`; a mesh mostly
//!   two-sided — a quarter of its triangles or more, or built as if (`distanceFieldTwoSided`) — has
//!   it grown by a texel (`grid.rs`);
//! - its mip 0 holds `size × density × scale / 7` bricks along an axis, rounded and held between 1
//!   and the most the resolution allows (`grid.rs`); each mip halves them, rounding up;
//! - a brick holds 8 voxels an axis, 7 of them its own and the eighth shared with the next brick
//!   for the trilinear filter; the field keeps a voxel's border around the mesh for the gradient;
//! - a voxel holds its distance, in the band of four voxels either side of the surface, in one
//!   byte (`brick.rs`): the unsigned distance is the nearest triangle's; it is negative when more
//!   than a quarter of 98 rays across the sphere hit a back face (`samples.rs`, `scene.rs`);
//! - a brick holding only the far side of the band, all 0 or all 255, is not stored; its cell of
//!   the indirection table holds `0xffffffff` (`build.rs`).
//!
//! `distanceFields.bin` (`encode.rs`) holds every mesh's field: its box, its mips' placement in the
//! volume and their data. The manifest's `distanceFields` section names it.
pub(crate) mod abi;
mod brick;
mod build;
mod encode;
mod grid;
mod samples;
mod scene;
mod settings;
mod stage;

pub(crate) use settings::DistanceFieldSettings;
pub(crate) use stage::{stage_distance_fields, DistanceFieldInputs};
