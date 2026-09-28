//! What every reduction of a primitive reads beside its level's locks: the welds by position, by
//! position and texture coordinates and by everything a page stores, the seams and mirrors, the
//! extents of the parts — computed once, grown with every vertex a solved reduction places.
use super::charts::{mirror_vertices, seam_vertices};
use super::clusters::{normalized_bits, position_key, weld_by};
use super::clusters::{weld_positions, weld_positions_and_uv};
use super::grown::Placed;
use super::{DagAttributes, GroupReductionInput};
use crate::geometry_page::Attribute as Carried;
use crate::qem::Attribute;
use std::sync::OnceLock;

/// What every reduction of a primitive reads beside its level's locks, computed once.
/// Grown with every vertex a solved reduction places (`grown::Placed`).
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

impl<'a> GroupReductionInput<'a> {
    /// Per vertex, where a chart meets its mirror image; empty without a texture set.
    pub(super) fn mirrors(&self) -> &'a [bool] {
        self.mirrors.of(self.weld)
    }
}
