//! Step 1 of the build's input, rebuilt (`built.rs`): every vertex's normal and stored tangent as
//! a mesh build computes them before it lays its vertices, by its rules (`FrameRules`).
//!
//! **Cleared.** When the rules rebuild every normal, every normal is first nothing; when they
//! rebuild every stored tangent — they name the normals or the tangents —, every stored tangent
//! and its sign are first nothing.
//!
//! **Faces** (`face.rs`): each triangle's normal, tangent and binormal over its corners measured
//! in centimetres, compared to nothing at the rules' threshold; when the rules weigh them, each
//! corner's weight, its triangle's area times its angle.
//!
//! **Vertices.** A vertex is rebuilt when its frame is not whole: with stored tangents, when its
//! normal or its tangent is nearly nothing (1e-4 on every axis), or its unit tangent, unit normal
//! and unit bitangent are not all something; without, when its normal is nothing (1e-8 on every
//! axis), the only part of the frame the pages take. Its triangles fall in groups, two triangles
//! of one group when they share an edge from it — every edge is soft, as a mesh's reader marks
//! none hard. Each group sums its triangles' normals — and their tangents and binormals unless the
//! tangent spaces lay the stored tangents —, each times its corner's weight when the rules weigh
//! them, those that are then something; each sum made unit. A corner of the group takes the
//! group's normal when its vertex's own is nothing. Its tangent — its own when something, else
//! the group's — and its bitangent — its tangent across its normal, unit, times its sign when both
//! are something, else the group's binormal — are made orthonormal around the normal, and its
//! sign is the handedness of the three.
//!
//! **Tangent spaces.** When the rules rebuild every stored tangent by the tangent spaces
//! (`mikk.rs`), each corner takes its tangent from them, over its vertex's position in
//! centimetres, its own normal and its vertex's first texture coordinates: its sign is −1 where
//! its group's texture mapping keeps its orientation, 1 elsewhere, the bitangent the build lays
//! running against the generator's.
//!
//! **Laid.** A vertex whose corners take different frames is cut in pieces: its first corner's
//! frame stays on it, every other frame, in the order a corner first takes it, goes on a copy of
//! it laid after every vertex — the source vertex it copies pushed on `origin` —, which the
//! corners taking that frame then point at.
mod face;
mod group;

use super::{mikk, InputRules};
use crate::simplify::CENTIMETRES;
use face::{corner_weights, face_frame, nothing, something, unit_or_nothing, NEARLY, SMALL, V3};
use group::{Fans, Grouping};
use rayon::prelude::*;
use trillion3d_math::vector::vec3::{cross, point_f32};
use trillion3d_math::vector::vecn::scale;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_NORMAL, FLAG_TANGENT, FLAG_UV};

/// How a rebuild reads a mesh's frames (`FrameRules::of`): whether it rebuilds every normal, every
/// stored tangent, those by the tangent spaces, whether it weighs each triangle's part by its
/// corner's weight, and the threshold its faces' normals are compared to nothing at.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct FrameRules {
    pub normals: bool,
    pub tangents: bool,
    pub spaces: bool,
    pub weighted: bool,
    pub threshold: f32,
}

impl FrameRules {
    /// The rules of a mesh its build reads by `rules`. A mesh without bones rebuilds every normal
    /// when they name it, every stored tangent when they name it or the normals, those by the
    /// tangent spaces when they name them, its faces compared at 0. A skinned mesh's build keeps
    /// the frames it reads, rebuilding only those that are not whole, its faces compared at 1e-8.
    /// Both weigh their triangles when the rules name it.
    pub fn of(rules: &InputRules, skinned: bool) -> Self {
        Self {
            normals: !skinned && rules.recompute_normals,
            tangents: !skinned && (rules.recompute_normals || rules.recompute_tangents),
            spaces: !skinned && rules.mikk_tangents,
            weighted: rules.weighted_normals,
            threshold: if skinned { SMALL } else { 0.0 },
        }
    }
}

/// A corner's frame: its normal, and its stored tangent's direction and sign — nothing when the
/// vertex stores none.
type Frame = (V3, [f32; 4]);

/// The frames, laid as `carried` lays them, of the vertices a rebuild reads.
struct Frames<'c> {
    normals: &'c [f32],
    tangents: Option<&'c [f32]>,
}
impl Frames<'_> {
    fn of(&self, v: usize) -> Frame {
        let n = &self.normals[v * 3..v * 3 + 3];
        let t = (self.tangents).map_or([0.0; 4], |t| std::array::from_fn(|k| t[v * 4 + k]));
        ([n[0], n[1], n[2]], t)
    }
    /// Whether vertex `v`'s frame is whole (the module's rule).
    fn whole(&self, v: usize) -> bool {
        let (n, [tx, ty, tz, sign]) = self.of(v);
        if self.tangents.is_none() {
            return !nothing(n, SMALL);
        }
        let t = [tx, ty, tz];
        let (x, z) = (unit_or_nothing(t, SMALL), unit_or_nothing(n, SMALL));
        let y = unit_or_nothing(scale(unit_or_nothing(cross(x, z), SMALL), sign), SMALL);
        let unit = [x, y, z].iter().all(|&v| something(v, SMALL));
        !nothing(n, NEARLY) && !nothing(t, NEARLY) && unit
    }
}

/// Rebuilds the normals and stored tangents of the vertices of `carried` over the triangles
/// `triangles` of `positions` by `rules` (the module's rule): a vertex cut in pieces lays its
/// copies after every vertex, the corners taking them pointing at them, each copy's source vertex
/// pushed on `origin`.
pub(super) fn rebuild(
    positions: &mut Vec<f32>,
    carried: &mut [Attribute],
    triangles: &mut [u32],
    origin: &mut Vec<u32>,
    rules: FrameRules,
) {
    let at = |flag| carried.iter().position(|a: &Attribute| a.flag == flag);
    let (Some(normal_at), tangent_at, uv_at) = (at(FLAG_NORMAL), at(FLAG_TANGENT), at(FLAG_UV))
    else {
        return;
    };
    if rules.normals {
        carried[normal_at].values.fill(0.0);
    }
    let tangents_rebuilt = tangent_at.filter(|_| rules.tangents);
    if let Some(t) = tangents_rebuilt {
        carried[t].values.fill(0.0);
    }
    let spaces = tangents_rebuilt.is_some() && rules.spaces;
    let vertices = positions.len() / 3;
    let fans = Fans::of(triangles, vertices);
    let frames = Frames {
        normals: &carried[normal_at].values,
        tangents: tangent_at.map(|t| &carried[t].values[..]),
    };
    let whole: Vec<bool> = (0..vertices)
        .into_par_iter()
        .map(|v| frames.whole(v))
        .collect();
    if !spaces && (0..vertices).all(|v| whole[v] || fans.at(v).is_empty()) {
        return;
    }
    let point = |v: u32| point_f32(positions, v as usize).map(|x| x * CENTIMETRES);
    let uv = |v: u32| {
        uv_at.map_or([0.0; 2], |a| {
            let values = &carried[a].values;
            [values[v as usize * 2], values[v as usize * 2 + 1]]
        })
    };
    let corners_of = |t: usize| -> [u32; 3] { std::array::from_fn(|k| triangles[t * 3 + k]) };
    let count = triangles.len() / 3;
    // Each triangle's corners read in centimetres once, for its frame and its corners' weights.
    let (faces, weights): (Vec<[V3; 3]>, Vec<Option<[f32; 3]>>) = (0..count)
        .into_par_iter()
        .map(|t| {
            let p = corners_of(t).map(point);
            let face = face_frame(p, corners_of(t).map(uv), rules.threshold);
            (face, rules.weighted.then(|| corner_weights(p)))
        })
        .unzip();
    // None when the rules weigh no corner.
    let weights: Vec<[f32; 3]> = weights.into_iter().flatten().collect();
    let grouping = Grouping {
        triangles,
        faces: &faces,
        weights: &weights,
        tangents: tangent_at.is_some() && !spaces,
    };
    // Each corner's frame, laid first in the order of the fans, one vertex's after another.
    let mut fanned: Vec<Frame> = vec![([0.0; 3], [0.0; 4]); triangles.len()];
    let mut pieces: Vec<(usize, &mut [Frame])> = Vec::with_capacity(vertices);
    let mut rest = &mut fanned[..];
    for v in 0..vertices {
        let (piece, tail) = std::mem::take(&mut rest).split_at_mut(fans.at(v).len());
        pieces.push((v, piece));
        rest = tail;
    }
    pieces.into_par_iter().for_each(|(v, out)| match whole[v] {
        true => out.fill(frames.of(v)),
        false => grouping.frames(v as u32, fans.at(v), frames.of(v), out),
    });
    let mut corners = vec![([0.0; 3], [0.0; 4]); triangles.len()];
    for (&(t, k), &frame) in fans.corners.iter().zip(&fanned) {
        corners[t as usize * 3 + k as usize] = frame;
    }
    if spaces {
        let read: Vec<mikk::Corner> = (triangles.par_iter().zip(&corners))
            .map(|(&v, frame)| mikk::Corner {
                position: point(v),
                normal: frame.0,
                uv: uv(v),
            })
            .collect();
        for (frame, ([x, y, z], kept)) in corners.iter_mut().zip(mikk::spaces(&read)) {
            frame.1 = [x, y, z, if kept { -1.0 } else { 1.0 }];
        }
    }
    lay(
        positions,
        carried,
        (normal_at, tangent_at),
        (triangles, origin),
        (&fans, &corners),
    );
}

/// Lays every corner's frame `corners` on its vertex or on a copy of it (the module's rule), over
/// the corners naming each vertex `fans`.
fn lay(
    positions: &mut Vec<f32>,
    carried: &mut [Attribute],
    (normal, tangent): (usize, Option<usize>),
    (triangles, origin): (&mut [u32], &mut Vec<u32>),
    (fans, corners): (&Fans, &[Frame]),
) {
    let write = |carried: &mut [Attribute], v: usize, (n, t): Frame| {
        carried[normal].values[v * 3..v * 3 + 3].copy_from_slice(&n);
        if let Some(at) = tangent {
            carried[at].values[v * 4..v * 4 + 4].copy_from_slice(&t);
        }
    };
    let mut taken: Vec<(Frame, u32)> = Vec::new();
    for v in 0..fans.start.len() - 1 {
        taken.clear();
        for &(t, k) in fans.at(v) {
            let c = t as usize * 3 + k as usize;
            let frame = corners[c];
            triangles[c] = match taken.iter().find(|(f, _)| *f == frame) {
                Some(&(_, laid)) => laid,
                None => {
                    let laid = match taken.is_empty() {
                        true => v as u32,
                        false => {
                            let copy = (positions.len() / 3) as u32;
                            positions.extend_from_within(v * 3..v * 3 + 3);
                            for a in carried.iter_mut() {
                                a.values.extend_from_within(v * a.width..(v + 1) * a.width);
                            }
                            origin.push(v as u32);
                            copy
                        }
                    };
                    write(carried, laid as usize, frame);
                    taken.push((frame, laid));
                    laid
                }
            };
        }
    }
}
