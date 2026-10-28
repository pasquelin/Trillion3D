//! The sparse volume textures of a scene: the volumes a heterogeneous volume reads, the `.vdb`
//! files its nodes cite, read (`vdb.rs`), their active voxels cut in pages and tiles with a mip
//! chain (`texture.rs`), the tiles shared and compressed (`derived.rs`), and written in
//! `sparseVolumes.bin` (`encode.rs`, `abi.rs`), which the manifest's `sparseVolumes` section names.
//!
//! A node cites a volume by the extension `TRILLION3D_sparse_volume`, whose `uri` is a `.vdb` file
//! under the source's folder; a file whose name ends with a number makes the first frame of the
//! sequence of the files that follow it, which play as the frames of an animated volume
//! (`import.rs`).
pub(crate) mod abi;
mod derived;
mod encode;
pub(crate) mod format;
mod import;
mod stage;
#[cfg(test)]
mod tests;
mod texture;
mod vdb;

pub(crate) use stage::{linked_volumes, write_sparse_volumes, SparseVolumeInputs};
