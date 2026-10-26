//! The coordinates of a merged layer that does not reuse its meshes' lightmap sets
//! (`reuseLightmapUVs: false`): every entry's mesh laid out together, once, in one atlas, instead
//! of each on a square of its own.
//!
//! 1. The merged mesh: the triangles of every entry's first part — the parts the entry stands for
//!    look alike, each baked from the first —, in the order of the entries.
//! 2. The identical triangles folded (`Folded`): a triangle of an entry whose corners hold the same
//!    values in every texture set and the same colour as an earlier triangle of that entry is that
//!    triangle, not another: it is laid out once and takes its coordinates. Triangles of two
//!    entries are never one: an entry is a material on a mesh. The key is the entry and those
//!    values, 128 bits of their digest, where a 32-bit checksum chain would take two triangles
//!    whose texture coordinates differ for one (for instance a corner at `(0.25, 0.5)` and one at
//!    `(0.2504431, 0.5157871)` have the same 32-bit checksum of their bytes).
//! 3. The unique triangles laid out as one mesh by the layer's method (`unique_coordinates`): the
//!    old layout of the first texture sets (`legacy`) or the unwrap of the points (`unwrapped`),
//!    each entry's points welded apart from the others'. A triangle the unwrap does not hold keeps
//!    its own first set, zero without one. Where the unwrap of the whole fails (the spectral
//!    charts cut or pack nothing) there is nothing laid out together: `laid_together` is none and
//!    each mesh is laid out on its own instead (`flat.rs`, `laid_of`).
//! 4. With the old layout, the coordinates of every corner of every entry scaled together to fill
//!    the unit square (`legacy::scaled_to_box`).
//!
//! Each entry's images are then baked at these coordinates straight into the one atlas, a texel
//! written where a triangle covers it and nowhere else (`images`): no cell, no gutter.
use super::ground::{own_set, welded, Welded};
use super::legacy::{scaled_to_box, LayoutCorners};
use crate::hlod::flatten::first_seen::first_seen;
use crate::hlod::flatten::merge::Part;
use crate::hlod::flatten::unwrapped;
use crate::hlod::options::HlodUvMethod;
use crate::support::digest::digest_words;
use rayon::prelude::*;
use std::ops::Range;
use trillion3d_page_codec::{FLAG_COLOR, UV_FLAGS};

/// Whether a triangle is the same triangle by the attribute `flag` besides its entry: its values in
/// every texture set, and its colour.
fn same_by(flag: u32) -> bool {
    flag == FLAG_COLOR || UV_FLAGS.contains(&flag)
}

/// The key of every triangle of `part`, the first of entry `entry`: the entry, then each corner's
/// values in the attributes `same_by` names that `part` carries (`digest_words`), the triangles keyed
/// on all threads, in order.
fn keys(part: &Part, entry: u32) -> Vec<u128> {
    let (positions, attributes, indices) = &part.geometry;
    let vertices = positions.len() / 3;
    let carried: Vec<(&[f32], usize)> = (attributes.iter())
        .filter(|a| same_by(a.flag))
        .map(|a| (&a.values[..vertices * a.width], a.width))
        .collect();
    let key = |words: &mut Vec<u32>, tri: &[u32; 3]| {
        words.clear();
        words.push(entry);
        for &v in tri {
            for &(values, width) in &carried {
                let at = v as usize * width;
                words.extend(values[at..at + width].iter().map(|x| x.to_bits()));
            }
        }
        digest_words(words.iter().copied())
    };
    let triangles = indices.as_chunks::<3>().0;
    triangles.par_iter().map_init(Vec::new, key).collect()
}

/// The triangles of the entries' first parts, numbered in order — entry after entry —, each one
/// the unique triangle it folds into.
struct Folded {
    /// Where each entry's triangles start in the numbering, and where the last ends.
    starts: Vec<usize>,
    /// Per triangle, the rank of the unique triangle it is: unique triangles are numbered in the
    /// order their first copy is met.
    ranks: Vec<u32>,
    /// Per triangle, whether it is the first copy of its unique triangle.
    first: Vec<bool>,
}

impl Folded {
    fn of(firsts: &[&Part]) -> Self {
        let mut starts = Vec::with_capacity(firsts.len() + 1);
        let mut keys_of = Vec::new();
        for (entry, part) in firsts.iter().enumerate() {
            starts.push(keys_of.len());
            keys_of.extend(keys(part, entry as u32));
        }
        starts.push(keys_of.len());
        let (_, ranks) = first_seen(keys_of);
        // Ranks are given in the order the triangles are met: a triangle is the first copy of its
        // rank when its rank is the next unseen.
        let mut seen = 0;
        let first = ranks
            .iter()
            .map(|&rank| {
                let is_first = rank == seen;
                seen += u32::from(is_first);
                is_first
            })
            .collect();
        Self {
            starts,
            ranks,
            first,
        }
    }

    /// The numbers of entry `entry`'s triangles.
    fn of_entry(&self, entry: usize) -> Range<usize> {
        self.starts[entry]..self.starts[entry + 1]
    }
}

/// The unique triangles as one mesh: each entry's welded points that a unique triangle names, in
/// their order — each entry's apart from the others' —, and the unique triangles over them.
fn merged(firsts: &[&Part], folded: &Folded) -> (Vec<[f64; 3]>, Vec<[usize; 3]>) {
    let (mut points, mut triangles) = (Vec::new(), Vec::new());
    for (entry, part) in firsts.iter().enumerate() {
        let Welded {
            points: own,
            triangles: own_triangles,
        } = welded(part);
        let first = &folded.first[folded.of_entry(entry)];
        let kept: Vec<[usize; 3]> = (own_triangles.iter().zip(first))
            .filter_map(|(&tri, &is_first)| is_first.then_some(tri))
            .collect();
        let mut named = vec![false; own.len()];
        kept.iter().flatten().for_each(|&v| named[v] = true);
        let mut number = vec![0usize; own.len()];
        for (v, point) in own.into_iter().enumerate().filter(|&(v, _)| named[v]) {
            number[v] = points.len();
            points.push(point);
        }
        triangles.extend(kept.iter().map(|tri| tri.map(|v| number[v])));
    }
    (points, triangles)
}

/// The coordinates of the unique triangles per corner, and whether the unwrap holds each: laid out
/// as `method` says (module doc, 3); the old layout of the first texture sets where it finds one,
/// else the default unwrap (`flatten::unwrapped`). None where the unwrap of the whole fails.
fn unique_coordinates(
    firsts: &[&Part],
    folded: &Folded,
    (method, side): (HlodUvMethod, usize),
) -> Option<(Vec<[f64; 2]>, Vec<bool>)> {
    if method == HlodUvMethod::Legacy {
        let mut corners = LayoutCorners::default();
        for (entry, part) in firsts.iter().enumerate() {
            let first = &folded.first[folded.of_entry(entry)];
            corners.push(part, |t| first[t]);
        }
        if let Some(laid) = corners.lay_out(side) {
            let held = vec![true; laid.len() / 3];
            return Some((laid.iter().map(|uv| uv.map(f64::from)).collect(), held));
        }
    }
    let (points, triangles) = merged(firsts, folded);
    unwrapped(&points, &triangles, method)
}

/// Every entry's triangles' coordinates, per corner in the entry's own order: those of the unique
/// triangle each folds into, its own first set where the unwrap does not hold it.
fn per_entry(
    firsts: &[&Part],
    folded: &Folded,
    (laid, held): (&[[f64; 2]], &[bool]),
) -> Vec<Vec<[[f64; 2]; 3]>> {
    (firsts.iter().enumerate())
        .map(|(entry, part)| {
            let ranks = &folded.ranks[folded.of_entry(entry)];
            (part.geometry.2.as_chunks::<3>().0.iter().zip(ranks))
                .map(|(&tri, &rank)| {
                    let u = rank as usize;
                    match held[u] {
                        true => [laid[3 * u], laid[3 * u + 1], laid[3 * u + 2]],
                        false => own_set(part, tri),
                    }
                })
                .collect()
        })
        .collect()
}

/// The coordinates of the entries whose first parts are `firsts`, laid out together as `method`
/// says for an atlas `side` texels wide (module doc): per entry, per triangle, per corner. None
/// where the unwrap of the whole fails.
pub(super) fn laid_together(
    firsts: &[&Part],
    method: HlodUvMethod,
    side: usize,
) -> Option<Vec<Vec<[[f64; 2]; 3]>>> {
    if firsts.is_empty() {
        return Some(Vec::new());
    }
    let folded = Folded::of(firsts);
    let (laid, held) = unique_coordinates(firsts, &folded, (method, side))?;
    let mut sets = per_entry(firsts, &folded, (&laid, &held));
    if method == HlodUvMethod::Legacy {
        scaled_to_box(&mut sets);
    }
    Some(sets)
}

#[cfg(test)]
mod tests;
