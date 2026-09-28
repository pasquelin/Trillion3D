//! The vertex attributes a reduction answers for: normals and texture sets count in the
//! simplification error, texture seams are protected, and a coarse corner keeps the normal of
//! its own face.
use super::charts::{mirror_vertices, seam_vertices};
use super::clusters::{normalized_bits, position_key, weld_by};
use super::clusters::{weld_positions, weld_positions_and_uv};
use super::placed::Placed;
use super::quality::{face_normal, unit_normal};
use super::GroupReductionInput;
use crate::geometry_page::{Attribute as Carried, FLAG_NORMAL, FLAG_UV, FLAG_UV1};
use crate::qem::Attribute;
use crate::shared_math::dot;
use std::collections::HashMap;
use std::sync::OnceLock;

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

/// What every reduction of a primitive reads beside its level's locks, computed once.
/// Grown with every vertex a solved reduction places (`placed::Placed`).
pub(super) struct Welds<'a> {
    pub weld: Vec<u32>,
    /// `None` without a texture set: the seam weld is then the position weld.
    weld_seam: Option<Vec<u32>>,
    exact: Vec<u32>,
    /// Empty without a texture set: no vertex is then on a seam.
    seams: Vec<bool>,
    mirrors: Mirrors<'a>,
    /// Per vertex, the extent of its part (`vanished::part_extents`).
    extents: Vec<f64>,
}
impl<'a> Welds<'a> {
    pub fn of(positions: &[f32], attributes: DagAttributes<'a>, indices: &'a [u32]) -> Self {
        let weld = weld_positions(positions, indices);
        let uv_sets = attributes.uv_sets();
        let weld_seam =
            (!uv_sets.is_empty()).then(|| weld_positions_and_uv(positions, &uv_sets, indices));
        let seams = weld_seam.as_deref().map_or_else(Vec::new, |weld_seam| {
            seam_vertices(&weld, weld_seam, indices)
        });
        Self {
            exact: weld_exact(positions, attributes.carried, indices),
            extents: super::vanished::part_extents(positions, indices, &weld),
            mirrors: Mirrors {
                found: OnceLock::new(),
                vertices: weld.len(),
                uv_sets,
                indices,
            },
            weld,
            weld_seam,
            seams,
        }
    }
    /// The input of one reduction over the level's vertex arrays and the attributes the
    /// simplifier weighs of them; `normal_bound` is its group's (`quality::deviation_bound`).
    pub fn input<'b>(
        &'b self,
        positions: &'b [f32],
        attributes: DagAttributes<'b>,
        weighted: &'b [Attribute<'b>],
        locks: &'b [bool],
        normal_bound: f64,
    ) -> GroupReductionInput<'b> {
        GroupReductionInput {
            positions,
            attributes,
            weighted,
            normal_bound,
            locks,
            seams: &self.seams,
            mirrors: &self.mirrors,
            weld: &self.weld,
            exact: &self.exact,
            weld_seam: self.weld_seam.as_deref().unwrap_or(&self.weld),
            extents: &self.extents,
        }
    }
    /// Appends what the level's welds say of the vertices a solved reduction placed, `shift`
    /// renumbering them after those already placed at the level.
    pub fn extend(&mut self, placed: Placed, shift: impl Fn(u32) -> u32) {
        self.weld.extend(placed.weld.into_iter().map(&shift));
        if let Some(weld_seam) = &mut self.weld_seam {
            weld_seam.extend(placed.weld_seam.into_iter().map(&shift));
        }
        self.exact.extend(placed.exact.into_iter().map(&shift));
        self.seams.extend(placed.seams);
        // The solve that placed them read the mirrors first: they are found.
        if let Some(mirrors) = self.mirrors.found.get_mut() {
            mirrors.extend(placed.mirrors);
        }
        self.extents.extend(placed.extents);
    }
}

/// Where a chart meets its mirror image (`charts::mirror_vertices`), found the first time a solve
/// asks: a primitive no group of which is seam-locked never pays for it.
pub(super) struct Mirrors<'a> {
    found: OnceLock<Vec<bool>>,
    /// The source's vertex count, texture sets and triangles.
    vertices: usize,
    uv_sets: Vec<&'a [f32]>,
    indices: &'a [u32],
}
impl Mirrors<'_> {
    /// Per vertex, on a mirror; empty without a texture set. `weld` is the level's position weld.
    pub fn of(&self, weld: &[u32]) -> &[bool] {
        self.found
            .get_or_init(|| mirror_vertices(&weld[..self.vertices], &self.uv_sets, self.indices))
    }
}

/// Canonical vertex per position and every carried attribute: copies a page cannot tell apart are
/// one vertex, so an unindexed mesh reduces as the indexed one it draws the same as. Nothing is
/// lost: coarse levels point at a copy identical in everything the page stores.
pub fn weld_exact(positions: &[f32], carried: &[&Carried], indices: &[u32]) -> Vec<u32> {
    weld_by(positions.len() / 3, indices, |id| {
        key(
            positions,
            id as usize,
            carried.iter().map(|a| (&a.values[..], a.width)),
        )
    })
}

/// The bits of vertex `v`'s position and of its `width` floats of each of `attributes`: equal
/// keys, one vertex to a page.
pub(super) fn key<'v>(
    positions: &[f32],
    v: usize,
    attributes: impl Iterator<Item = (&'v [f32], usize)>,
) -> Vec<u32> {
    let mut key = position_key(positions, v as u32).to_vec();
    for (values, width) in attributes {
        let copy = values.get(v * width..v * width + width).unwrap_or(&[]);
        key.extend(copy.iter().map(|&x| normalized_bits(x)));
    }
    key
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
