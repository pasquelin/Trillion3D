//! The vertex attributes a reduction answers for: normals and texture sets count in the
//! simplification error, texture seams are protected, and a coarse corner keeps the normal of
//! its own face.
use super::quality::{face_normal, unit_normal};
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
    pub(super) fn weighted(&self) -> Vec<Attribute<'a>> {
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

/// Points every corner of `simplified` at the copy of its position and texture coordinates, among
/// those `source` uses, whose normal is closest to its triangle's face normal, and only among the
/// copies a face of `source` turning the same way draws. Permissive mode merges the copies of a
/// hard edge into one; the geometry and the texture are the same for every copy, so only the
/// normal changes, and it is the one of the corner's own face.
///
/// Returns the corners no such copy exists for, welded by `weld_seam`: a coarse face whose
/// corners only ever belonged to faces turned another way — the underside of a board its
/// thickness collapsed onto the top — would inherit another face's normal (#484). The caller
/// retries with them locked.
pub fn own_normals(
    simplified: &mut [u32],
    source: &[u32],
    weld_seam: &[u32],
    positions: &[f32],
    normals: &[f32],
) -> Vec<u32> {
    // Per copy, the faces of `source` that draw it; per position, its copies.
    let mut owners: HashMap<u32, Vec<[f64; 3]>> = HashMap::new();
    let mut copies: HashMap<u32, Vec<u32>> = HashMap::new();
    for tri in source.as_chunks::<3>().0 {
        let face = face_normal(positions, tri).map(|(face, _)| face);
        for &v in tri {
            let faces = owners.entry(v).or_default();
            faces.extend(face);
            let list = copies.entry(weld_seam[v as usize]).or_default();
            if !list.contains(&v) {
                list.push(v);
            }
        }
    }
    let mut foreign = Vec::new();
    for tri in simplified.as_chunks_mut::<3>().0 {
        let Some((face, _)) = face_normal(positions, tri) else {
            continue;
        };
        let agrees = |v: u32| {
            owners
                .get(&v)
                .is_some_and(|f| f.iter().any(|&f| dot(f, face) > 0.0))
        };
        let facing = |v: u32| unit_normal(normals, v).map_or(-2.0, |n| dot(n, face));
        for corner in tri.iter_mut() {
            let key = weld_seam[*corner as usize];
            let own = copies
                .get(&key)
                .into_iter()
                .flatten()
                .copied()
                .filter(|&v| agrees(v));
            match own.max_by(|&a, &b| facing(a).total_cmp(&facing(b))) {
                Some(best) => *corner = best,
                None => foreign.push(key),
            }
        }
    }
    foreign
}
