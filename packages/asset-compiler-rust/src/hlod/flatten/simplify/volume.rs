//! The simplify builder's volume: a sparse signed distance field of the cell's sources in a narrow
//! band about their surface (`field`), its gaps closed by dilating and eroding it (`gaps`), and
//! its iso-surface extracted as a mesh of quads and triangles (`surface`), on the tree of leaves
//! and tiles every field lives in (`tree`). Index space is world space over the voxel: voxel
//! `[i, j, k]` is centred at `voxel · [i, j, k]`.
//!
//! The voxelization, its sign, its flood fill and pruning, the union of two fields and the
//! iso-surface extraction are ported from OpenVDB, which carries this notice:
//!
//! ```text
//! Copyright Contributors to the OpenVDB Project
//! SPDX-License-Identifier: Apache-2.0
//! ```
pub(crate) mod field;
pub(crate) mod gaps;
pub(crate) mod surface;
pub(crate) mod tree;
