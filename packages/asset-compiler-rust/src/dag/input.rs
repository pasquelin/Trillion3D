//! The source as a build reads it before its first cluster, step after step as a mesh build lays
//! its vertices, by the mesh's rules (`InputRules`):
//! 1. every vertex as built (`built.rs`): a value that is not finite replaced, the normals and the
//!    stored tangents rebuilt as the rules name them (`frames.rs`, the tangent spaces `mikk.rs`),
//!    the normal and the stored tangent made unit, the colour brought to the bytes of its sRGB
//!    encoding;
//! 2. a mesh without bones drops the triangles two of whose corners meet (`kept_triangles`);
//! 3. every corner pointed at the first vertex laid before it at its position that matches it
//!    within the build's tolerances, or at its own (`weld.rs`): at the very position for a mesh
//!    without bones; within the rules' skinned weld (`SkinnedWeld`) for a skinned one, which keeps
//!    apart two corners of one vertex that find no match and then drops the triangles two of whose
//!    corners are one vertex (`skinned.rs`);
//! 4. a colour white at every vertex dropped, every value held within its range, then every
//!    normal made unit, every stored tangent made unit across it with its sign `±1` and every
//!    colour clamped to [0, 1] (`finish.rs`), as every solve corrects the vertices it places.
//!
//! The DAG is built over each colour channel as its byte's share of 255, as the pages carry it;
//! the arrays the build hands on are held within range again (`finish::held`).
mod built;
mod colour;
pub(crate) use colour::{alpha_byte, srgb_byte};
mod finish;
mod frames;
mod mikk;
mod skinned;
mod weld;
pub(super) use built::{built, Built};
pub(super) use finish::{finished, held};
pub(super) use skinned::welded_skinned;
pub(super) use weld::welded;

use crate::simplify::NEAR_POINTS;
use trillion3d_math::vector::vec3::point_f32;

/// How a mesh's build reads it, as its settings name it (`MeshBuild`): whether it rebuilds every
/// normal (`recompute_normals`), every stored tangent (`recompute_tangents`), those by the tangent
/// spaces (`mikk_tangents`, `mikk.rs`), whether a vertex's normal weighs each triangle by its area
/// times its angle there (`weighted_normals`) — a skinned mesh's build rebuilding only the frames
/// that are not whole (`frames::FrameRules::of`) —, and how far its skinned weld lets two corners
/// differ (`skinned_weld`). Each is the reference's default when none is named.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct InputRules {
    pub recompute_normals: bool,
    pub recompute_tangents: bool,
    pub mikk_tangents: bool,
    pub weighted_normals: bool,
    pub skinned_weld: SkinnedWeld,
}
impl Default for InputRules {
    fn default() -> Self {
        Self {
            recompute_normals: crate::DEFAULT_RECOMPUTE_NORMALS,
            recompute_tangents: crate::DEFAULT_RECOMPUTE_TANGENTS,
            mikk_tangents: crate::DEFAULT_MIKK_TSPACE,
            weighted_normals: crate::DEFAULT_WEIGHTED_NORMALS,
            skinned_weld: SkinnedWeld::default(),
        }
    }
}
impl InputRules {
    /// The rules of a mesh already built — an HLOD builder's, whose build the reference's builders
    /// tell to rebuild no normal and no tangent, or an object's own level 0 —: its frames kept as
    /// made, only those that are not whole rebuilt; the rest the defaults.
    pub fn as_made() -> Self {
        Self {
            recompute_normals: false,
            recompute_tangents: false,
            ..Self::default()
        }
    }
}

/// How far a skinned weld lets two corners differ on every axis and be one vertex (`skinned.rs`):
/// their positions, in metres (`position`); their normals, tangents and bitangents (`normal`);
/// each of their texture coordinates (`texture`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SkinnedWeld {
    pub position: f32,
    pub normal: f32,
    pub texture: f32,
}
impl Default for SkinnedWeld {
    fn default() -> Self {
        Self {
            position: crate::DEFAULT_SKINNED_WELD_POSITION as f32,
            normal: crate::DEFAULT_SKINNED_WELD_NORMAL as f32,
            texture: crate::DEFAULT_SKINNED_WELD_TEXTURE as f32,
        }
    }
}

/// The normal a vertex whose normal is out of range takes: up, +Y in glTF.
const UP: [f32; 3] = [0.0, 1.0, 0.0];
/// The tangent a vertex whose tangent is out of range takes: +X.
const FORWARD: [f32; 3] = [1.0, 0.0, 0.0];

/// The triangles of `indices` over `positions` the build keeps, in order: those of which no two
/// corners lie within `tolerance` of each other on every axis — `NEAR_POINTS` when `near`, else
/// zero, a corner repeated or two at the same point; and the rank of each of them in `indices`.
pub(super) fn kept_triangles(
    positions: &[f32],
    indices: &[u32],
    near: bool,
) -> (Vec<u32>, Vec<u32>) {
    let tolerance = if near { NEAR_POINTS } else { 0.0 };
    let meet = |a: [f32; 3], b: [f32; 3]| (0..3).all(|c| (a[c] - b[c]).abs() <= tolerance);
    let (mut kept, mut ranks) = (Vec::with_capacity(indices.len()), Vec::new());
    for (rank, t) in indices.as_chunks::<3>().0.iter().enumerate() {
        let [a, b, c] = t.map(|v| point_f32(positions, v as usize));
        if !(meet(a, b) || meet(a, c) || meet(b, c)) {
            kept.extend_from_slice(t);
            ranks.push(rank as u32);
        }
    }
    (kept, ranks)
}

/// Whether every float of `values` is finite.
fn finite(values: &[f32]) -> bool {
    values.iter().all(|x| x.is_finite())
}
