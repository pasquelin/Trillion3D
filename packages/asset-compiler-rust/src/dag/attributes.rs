//! The vertex attributes a reduction answers for: normals and texture sets count in the
//! simplification error, texture seams are protected, and a coarse corner keeps the normal of
//! its own face.
use super::clusters::{normalized_bits, position_key, weld_by};
use super::clusters::{weld_positions, weld_positions_and_uv};
use super::quality::{face_normal, unit_normal};
use super::GroupReductionInput;
use crate::geometry_page::{Attribute as Carried, FLAG_NORMAL, FLAG_UV, FLAG_UV1};
use crate::qem::Attribute;
use crate::shared_math::dot;
use std::collections::HashMap;

/// Normals are unit vectors: two opposite ones differ by 2, which this weight brings to the
/// region's extent, the position scale the error is clamped to (`qem`).
pub const NORMAL_WEIGHT: f32 = 0.5;
/// A texture coordinate spans one texture per unit: crossing a whole texture costs the region's
/// extent.
pub const UV_WEIGHT: f32 = 1.0;

/// Every attribute the pages carry beside the positions, and only those: the reduction answers
/// for what the pages draw, and a texture set no material reads never holds a group.
#[derive(Clone, Copy, Default)]
pub struct DagAttributes<'a> {
    pub carried: &'a [&'a Carried],
}
impl<'a> DagAttributes<'a> {
    fn values(&self, flag: u32) -> impl Iterator<Item = &'a [f32]> {
        self.carried
            .iter()
            .filter(move |a| a.flag == flag)
            .map(|a| &a.values[..])
    }
    /// Three floats per vertex, when the pages carry normals.
    pub fn normals(&self) -> Option<&'a [f32]> {
        self.values(FLAG_NORMAL).next()
    }
    /// Two floats per vertex per texture set; empty without one.
    pub fn uv_sets(&self) -> Vec<&'a [f32]> {
        self.values(FLAG_UV).chain(self.values(FLAG_UV1)).collect()
    }
    /// The attributes the simplifier weighs, normals first.
    fn weighted(&self) -> Vec<Attribute<'a>> {
        let normals = self.normals().map(|values| Attribute {
            values,
            width: 3,
            weight: NORMAL_WEIGHT,
        });
        let uvs = self.uv_sets().into_iter().map(|values| Attribute {
            values,
            width: 2,
            weight: UV_WEIGHT,
        });
        normals.into_iter().chain(uvs).collect()
    }
}

/// What every reduction of a primitive reads beside its level's locks, computed once.
pub(super) struct Welds<'a> {
    pub weld: Vec<u32>,
    /// `None` without a texture set: the seam weld is then the position weld.
    weld_seam: Option<Vec<u32>>,
    exact: Vec<u32>,
    /// Empty without a texture set: no vertex is then on a seam.
    seams: Vec<bool>,
    weighted: Vec<Attribute<'a>>,
    normals: Option<&'a [f32]>,
}
impl<'a> Welds<'a> {
    pub fn of(positions: &[f32], attributes: DagAttributes<'a>, indices: &[u32]) -> Self {
        let weld = weld_positions(positions, indices);
        let uv_sets = attributes.uv_sets();
        let weld_seam =
            (!uv_sets.is_empty()).then(|| weld_positions_and_uv(positions, &uv_sets, indices));
        let seams = weld_seam.as_deref().map_or_else(Vec::new, |weld_seam| {
            seam_vertices(&weld, weld_seam, indices)
        });
        Self {
            exact: weld_exact(positions, attributes.carried, indices),
            weld,
            weld_seam,
            seams,
            weighted: attributes.weighted(),
            normals: attributes.normals(),
        }
    }
    /// The input of one reduction; `normal_bound` is its group's (`quality::deviation_bound`).
    pub fn input<'b>(
        &'b self,
        positions: &'b [f32],
        locks: &'b [bool],
        normal_bound: f64,
    ) -> GroupReductionInput<'b> {
        GroupReductionInput {
            positions,
            attributes: &self.weighted,
            normals: self.normals,
            normal_bound,
            locks,
            seams: &self.seams,
            weld: &self.weld,
            exact: &self.exact,
            weld_seam: self.weld_seam.as_deref().unwrap_or(&self.weld),
        }
    }
}

/// Canonical vertex per position and every carried attribute: copies a page cannot tell apart are
/// one vertex, so an unindexed mesh reduces as the indexed one it draws the same as. Nothing is
/// lost: coarse levels point at a copy identical in everything the page stores.
pub fn weld_exact(positions: &[f32], carried: &[&Carried], indices: &[u32]) -> Vec<u32> {
    weld_by(positions.len() / 3, indices, |id| {
        let mut key = position_key(positions, id).to_vec();
        for attribute in carried {
            let i = id as usize * attribute.width;
            let copy = attribute.values.get(i..i + attribute.width).unwrap_or(&[]);
            key.extend(copy.iter().map(|&v| normalized_bits(v)));
        }
        key
    })
}

/// Per source vertex, whether its position is written under several texture coordinates: a seam
/// vertex, which permissive simplification must not merge across. `weld` is by position,
/// `weld_seam` by position and every texture set.
pub fn seam_vertices(weld: &[u32], weld_seam: &[u32], indices: &[u32]) -> Vec<bool> {
    let mut first = vec![u32::MAX; weld.len()];
    let mut seam = vec![false; weld.len()];
    for &v in indices {
        let (position, copy) = (weld[v as usize] as usize, weld_seam[v as usize]);
        if first[position] == u32::MAX {
            first[position] = copy;
        } else if first[position] != copy {
            seam[position] = true;
        }
    }
    (0..weld.len()).map(|v| seam[weld[v] as usize]).collect()
}

/// Points every corner of `simplified` at the copy of its position and texture coordinates, among
/// those `source` uses, whose normal is closest to its triangle's face normal. Permissive mode
/// merges the copies of a hard edge into one; the geometry and the texture are the same for every
/// copy, so only the normal changes, and it is the one of the corner's own face.
pub fn own_normals(
    simplified: &mut [u32],
    source: &[u32],
    weld_seam: &[u32],
    positions: &[f32],
    normals: &[f32],
) {
    let mut copies: HashMap<u32, Vec<u32>> = HashMap::new();
    for &v in source {
        let list = copies.entry(weld_seam[v as usize]).or_default();
        if !list.contains(&v) {
            list.push(v);
        }
    }
    copies.retain(|_, list| list.len() > 1);
    if copies.is_empty() {
        return;
    }
    for tri in simplified.as_chunks_mut::<3>().0 {
        let Some((face, _)) = face_normal(positions, tri) else {
            continue;
        };
        let facing = |v: u32| unit_normal(normals, v).map_or(-2.0, |n| dot(n, face));
        for corner in tri.iter_mut() {
            let Some(list) = copies.get(&weld_seam[*corner as usize]) else {
                continue;
            };
            for &candidate in list {
                if facing(candidate) > facing(*corner) {
                    *corner = candidate;
                }
            }
        }
    }
}
