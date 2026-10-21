//! Step 3 of the build's input (`input.rs`): the weld of a mesh build, over its vertices as built
//! (`built.rs`).
//!
//! The corners are read in the order of the triangles kept. A corner points at the first vertex
//! laid so far at its very position — every axis equal, `-0` and `+0` alike — that matches its
//! own: the normals, the stored tangents' directions and the bitangents within `SAME_NORMAL` on
//! every axis, each texture coordinate within `SAME_TEXTURE`, the colour bytes and the bones
//! equal. A corner none matches lays its own vertex. A vertex met again points where it pointed
//! the first time: what was laid since comes after.
//!
//! Only the vertices of one position meet, so each position's are welded on their own, in the
//! order the corners first name them: the same vertices laid, the same corners pointed.
//!
//! A skinned mesh is welded as a skinned build welds it (`skinned.rs`), by the same match within
//! its own tolerances (`SkinnedWeld`), its build's tangents compared too when its pages store
//! none (`Built::tangents`).
use super::Built;
use crate::dag::clusters::named_by;
use rayon::prelude::*;
use trillion3d_page_codec::edges::{first_uses, position_key};
use trillion3d_page_codec::{FLAG_NORMAL, FLAG_TANGENT, FLAG_UV, FLAG_UV1, FLAG_UV2, FLAG_UV3};

/// How far two unit vectors may differ on every axis and match: a normal, a tangent, a bitangent.
const SAME_NORMAL: f32 = 2e-5;
/// How far two texture coordinates may differ on each axis and match: a 1024th.
const SAME_TEXTURE: f32 = 1.0 / 1024.0;

/// Whether every float of `a` lies within `tolerance` of `b`'s.
fn near(a: &[f32], b: &[f32], tolerance: f32) -> bool {
    a.iter().zip(b).all(|(x, y)| (x - y).abs() <= tolerance)
}

/// Whether built vertex `v` matches vertex `u` laid at its position, its unit vectors within
/// `normal` and its texture coordinates within `texture` (the module's rule).
pub(super) fn matches(built: &Built, v: usize, u: usize, (normal, texture): (f32, f32)) -> bool {
    let apart =
        |vectors: &[[f32; 3]]| !vectors.is_empty() && !near(&vectors[v], &vectors[u], normal);
    if apart(&built.bitangents) || apart(&built.tangents) {
        return false;
    }
    built.carried.iter().all(|a| {
        let width = a.width;
        let (x, y) = (
            &a.values[v * width..][..width],
            &a.values[u * width..][..width],
        );
        match a.flag {
            FLAG_NORMAL => near(x, y, normal),
            FLAG_TANGENT => near(&x[..3], &y[..3], normal),
            FLAG_UV | FLAG_UV1 | FLAG_UV2 | FLAG_UV3 => near(x, y, texture),
            _ => x == y,
        }
    })
}

/// The corners of the triangles `kept` over the `built` vertices, each pointing at its weld's
/// vertex (the module's rule).
pub(in crate::dag) fn welded(built: &Built, kept: &[u32]) -> Vec<u32> {
    let vertices = built.positions.len() / 3;
    let first = first_uses(vertices, kept);
    // Every vertex the corners name, by its position, then by the rank of its first corner.
    let mut named = named_by(&first, |v| position_key(&built.positions, v));
    named.par_sort_unstable();
    let tolerances = (SAME_NORMAL, SAME_TEXTURE);
    // Where each position's run begins, then where the last ends: each run is welded on its own,
    // side by side on the pool.
    let mut starts: Vec<usize> = (0..named.len())
        .filter(|&i| i == 0 || named[i - 1].0 != named[i].0)
        .collect();
    starts.push(named.len());
    let pointed: Vec<(u32, u32)> = starts
        .par_windows(2)
        .flat_map_iter(|run| {
            let (mut laid, mut pointed) = (Vec::new(), Vec::new());
            for &(_, _, v) in &named[run[0]..run[1]] {
                let matched = |&u: &u32| matches(built, v as usize, u as usize, tolerances);
                match laid.iter().copied().find(matched) {
                    Some(u) => pointed.push((v, u)),
                    None => laid.push(v),
                }
            }
            pointed
        })
        .collect();
    let mut points_at: Vec<u32> = (0..vertices as u32).collect();
    for (v, u) in pointed {
        points_at[v as usize] = u;
    }
    kept.iter().map(|&v| points_at[v as usize]).collect()
}
