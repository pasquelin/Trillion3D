//! A mesh's cards: the few boxes, each looking at the mesh along one of the six axis directions,
//! that cover its surface — what a surface cache captures a mesh into.
//!
//! The cards are found from the mesh's level-0 triangles, in the reference's unit, the centimetre,
//! as its mesh build finds them (`build.rs`):
//! - a voxel volume over the mesh's bounds — its distance field's box where it has one —, grown by
//!   a centimetre each side: voxels of 10 cm, or larger so that no side holds more than 64
//!   (`volume.rs`);
//! - for each of the six directions, 32 rays through each column of the volume, jittered across it,
//!   cast against the direction from before the volume and continued past each surface they meet;
//!   a surface facing the direction squarely enough (`meshCardNormalThreshold`) and lying in a cell
//!   beyond the one after the last becomes a sample, and the samples of a cell make its surfels —
//!   a cell, its coverage, the cell along the rays it is first visible from (`surfels.rs`). Surfels
//!   inside the mesh's geometry are dropped: of 25 rays over the hemisphere about a surfel, more
//!   than 0.8 hit and more than 0.2 hit a back face (`visibility.rs`); the volume is tried again
//!   with a side of half the voxels while the surfels are more than 10 000;
//! - the clusters that cover the surfels: the outer cluster of the surfels the direction sees from
//!   outside and, for a mesh not mostly two-sided, again the most covering one from any cell
//!   along the rays on; a cluster is kept when its weighted coverage reaches 15 cells (the outer one
//!   half the mean area of a face of the volume, where that is less) and its density exceeds a third
//!   of `meshCardMinDensity`; the most covering are kept, up to `maxMeshCards` (`clusters.rs`);
//! - a card for each, the box of its cells extended by half a voxel along the rays and held within
//!   the mesh's bounds — 10 cm past them along the rays (`cards.rs`).
//!
//! An HLOD cell's actors have cards too, where their layer allows a distance field
//! (`allowDistanceField`): built from the actors' own level-0 triangles in the world's space, at
//! the settings of the scene's meshes (`actors.rs`).
//!
//! `meshCards.bin` (`encode.rs`) holds the cards of every mesh: its box and its cards. The
//! manifest's `meshCards` section names it.
pub(crate) mod abi;
mod actors;
mod build;
mod cards;
mod clusters;
mod encode;
mod memo;
mod settings;
mod stage;
mod surfels;
mod visibility;
mod volume;

pub(crate) use actors::actors_cards;
pub(crate) use encode::PlacedCards;
pub(crate) use settings::CardSettings;
pub(crate) use stage::{build_mesh_cards, write_mesh_cards, CardInputs};
