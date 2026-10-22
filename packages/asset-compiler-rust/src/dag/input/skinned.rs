//! Step 3 of the build's input for a skinned mesh (`input.rs`): the weld of a skinned build, over
//! its vertices as built (`built.rs`), corner by corner of the triangles as read, within the
//! mesh's tolerances (`SkinnedWeld`).
//!
//! **Neighbours.** Every corner is ranked by `0.30 x + 0.33 z + 0.37 y` of its position, ties by
//! corner. The corners are swept in that order (`Neighbours::sweep`): each meets the corners after
//! it until one ranks more than the position tolerance past it, and joins each whose position lies
//! within the tolerance of its own on every axis. A corner's neighbours are the list it belongs to,
//! in corner order.
//!
//! **Weld.** Every corner, in triangle order, points at the vertex the first of its neighbours
//! before it laid, when that one lies within the position tolerance of its position on every axis
//! and matches it as the mesh weld matches, within the normal and texture tolerances
//! (`weld::matches`, the bones equal); else it lays its own vertex — a copy of it laid after every
//! vertex when an earlier corner already laid it, the two kept apart. A triangle two of whose
//! corners then point at one vertex is dropped.
use super::weld::matches;
use super::{Built, SkinnedWeld};
use crate::support::neighbours::{rank_of, Neighbours};
use trillion3d_math::vector::vec3::point_f32;

/// No vertex.
const NONE: u32 = u32::MAX;

/// The corners of the `built` triangles as read, welded within `weld` as a skinned build welds
/// them (the module's rule), the triangles two of whose corners point at one vertex dropped; a
/// vertex laid twice is copied on `built`. Returns the corners and, per triangle kept, its rank
/// among the source's.
pub(in crate::dag) fn welded_skinned(built: &mut Built, weld: SkinnedWeld) -> (Vec<u32>, Vec<u32>) {
    let corners = built.indices.clone();
    let near = |a: [f32; 3], b: [f32; 3]| (0..3).all(|k| (a[k] - b[k]).abs() <= weld.position);
    let point = |built: &Built, c: usize| point_f32(&built.positions, corners[c] as usize);
    let mut ranked: Vec<(f32, u32)> = (0..corners.len())
        .map(|c| {
            // The reference's axes: glTF's `y` up is its `z`.
            let [x, y, z] = point(built, c);
            (rank_of([x, z, y]), c as u32)
        })
        .collect();
    ranked.sort_by(|a, b| {
        let rank = a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal);
        rank.then(a.1.cmp(&b.1))
    });
    let neighbours = Neighbours::sweep(corners.len(), &ranked, weld.position, |first, second| {
        near(point(built, first as usize), point(built, second as usize))
    });
    // Per corner that laid a vertex, the vertex it laid; per vertex, whether a corner laid it.
    let mut laid = vec![NONE; corners.len()];
    let mut taken = vec![false; built.positions.len() / 3];
    let tolerances = (weld.normal, weld.texture);
    let mut welded = Vec::with_capacity(corners.len());
    let mut ranks = Vec::new();
    for triangle in (0..corners.len()).step_by(3) {
        let mut points = [0u32; 3];
        for (k, point_at) in points.iter_mut().enumerate() {
            let (corner, v) = (triangle + k, corners[triangle + k] as usize);
            let earlier = neighbours
                .of(corner)
                .iter()
                .take_while(|&&d| (d as usize) < corner);
            let matched = (earlier.map(|&d| laid[d as usize]))
                .filter(|&u| u != NONE)
                .find(|&u| {
                    let there = u as usize;
                    let at = near(point(built, corner), point_f32(&built.positions, there));
                    at && matches(built, v, there, tolerances)
                });
            *point_at = matched.unwrap_or_else(|| {
                let own = match std::mem::replace(&mut taken[v], true) {
                    false => v as u32,
                    true => copy(built, v),
                };
                laid[corner] = own;
                own
            });
        }
        let [a, b, c] = points;
        if a != b && b != c && a != c {
            welded.extend(points);
            ranks.push(built.source[triangle / 3]);
        }
    }
    (welded, ranks)
}

/// Lays a copy of built vertex `v` after every vertex, the source vertex it copies pushed on the
/// origins; returns it.
fn copy(built: &mut Built, v: usize) -> u32 {
    let copy = built.positions.len() / 3;
    let source = match v.checked_sub(copy - built.origin.len()) {
        Some(past) => built.origin[past],
        None => v as u32,
    };
    built.positions.extend_from_within(v * 3..v * 3 + 3);
    for a in &mut built.carried {
        a.values.extend_from_within(v * a.width..(v + 1) * a.width);
    }
    for vectors in [&mut built.bitangents, &mut built.tangents] {
        if !vectors.is_empty() {
            vectors.push(vectors[v]);
        }
    }
    built.origin.push(source);
    copy as u32
}
