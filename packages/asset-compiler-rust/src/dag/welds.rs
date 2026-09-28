//! What every reduction of a primitive reads beside its level's locks: the welds by position, by
//! position and texture coordinates and by everything a page stores, the seams, the charts and
//! the extents of the parts — computed once, grown with every vertex a solved reduction places.
use super::attributes::{seam_vertices, weld_exact};
use super::charts::{vertex_charts, Chart};
use super::clusters::{normalized_bits, position_key};
use super::clusters::{weld_positions, weld_positions_and_uv};
use super::grown::Placed;
use super::{DagAttributes, GroupReductionInput};
use crate::qem::Attribute;
use std::sync::OnceLock;

/// One entry per vertex of the level for each question the welds answer; the source's first,
/// then every vertex a solved reduction placed.
#[derive(Default)]
pub(super) struct Columns {
    /// Canonical vertex by position.
    pub weld: Vec<u32>,
    /// Canonical vertex by position and every texture set; empty without a texture set, where
    /// it is the position weld.
    pub weld_seam: Vec<u32>,
    /// Canonical vertex by position and every carried attribute (`weld_exact`).
    pub exact: Vec<u32>,
    /// On a texture seam; empty without a texture set.
    pub seams: Vec<bool>,
    /// The extent of the part each lies in (`vanished::part_extents`).
    pub extents: Vec<f64>,
}
impl Columns {
    /// Appends `other`'s entries, `shift` renumbering the vertices they name.
    pub fn extend(&mut self, other: Columns, shift: impl Fn(u32) -> u32) {
        self.weld.extend(other.weld.into_iter().map(&shift));
        self.weld_seam
            .extend(other.weld_seam.into_iter().map(&shift));
        self.exact.extend(other.exact.into_iter().map(&shift));
        self.seams.extend(other.seams);
        self.extents.extend(other.extents);
    }
}

/// What every reduction of a primitive reads beside its level's locks, computed once.
/// Grown with every vertex a solved reduction places (`grown::Placed`).
pub(super) struct Welds<'a> {
    columns: Columns,
    charts: Charts<'a>,
}
impl<'a> Welds<'a> {
    pub fn of(positions: &[f32], attributes: DagAttributes<'a>, indices: &'a [u32]) -> Self {
        let weld = weld_positions(positions, indices);
        let uv_sets = attributes.uv_sets();
        let (weld_seam, seams) = match uv_sets.is_empty() {
            true => (Vec::new(), Vec::new()),
            false => {
                let weld_seam = weld_positions_and_uv(positions, &uv_sets, indices);
                let seams = seam_vertices(&weld, &weld_seam, indices);
                (weld_seam, seams)
            }
        };
        Self {
            charts: Charts {
                found: OnceLock::new(),
                vertices: weld.len(),
                uv_sets,
                indices,
            },
            columns: Columns {
                exact: weld_exact(positions, attributes.carried, indices),
                extents: super::vanished::part_extents(positions, indices, &weld),
                weld,
                weld_seam,
                seams,
            },
        }
    }
    /// Canonical vertex by position, per vertex of the level.
    pub fn weld(&self) -> &[u32] {
        &self.columns.weld
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
        let c = &self.columns;
        GroupReductionInput {
            positions,
            attributes,
            weighted,
            normal_bound,
            locks,
            seams: &c.seams,
            charts: &self.charts,
            weld: &c.weld,
            exact: &c.exact,
            weld_seam: if c.weld_seam.is_empty() {
                &c.weld
            } else {
                &c.weld_seam
            },
            extents: &c.extents,
        }
    }
    /// Appends what the level's welds say of the vertices a solved reduction placed, `shift`
    /// renumbering them after those already placed at the level.
    pub fn extend(&mut self, placed: Placed, shift: impl Fn(u32) -> u32) {
        self.columns.extend(placed.columns, shift);
        // The solve that placed them read the charts first: they are found.
        if let Some(charts) = self.charts.found.get_mut() {
            charts.extend(placed.charts);
        }
    }
}

/// The chart of every vertex (`charts::vertex_charts`), found the first time a solve asks: a
/// primitive no group of which is seam-locked never pays for them.
pub(super) struct Charts<'a> {
    found: OnceLock<Vec<Chart>>,
    /// The source's vertex count, texture sets and triangles.
    vertices: usize,
    uv_sets: Vec<&'a [f32]>,
    indices: &'a [u32],
}
impl Charts<'_> {
    /// Per vertex, its chart; empty without a texture set. `weld` and `weld_seam` are the level's.
    pub fn of(&self, weld: &[u32], weld_seam: &[u32]) -> &[Chart] {
        let n = self.vertices;
        let (uv_sets, indices) = (&self.uv_sets, self.indices);
        let find = || vertex_charts(&weld[..n], &weld_seam[..n], uv_sets, indices);
        self.found.get_or_init(find)
    }
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
    /// Per vertex, its chart (`charts::Chart`); empty without a texture set.
    pub(super) fn charts(&self) -> &'a [Chart] {
        self.charts.of(self.weld, self.weld_seam)
    }
    /// The charts, when `live` names a vertex a solve placed and the primitive has a texture set.
    pub(super) fn placed_charts(&self, live: &[u32]) -> Option<&'a [Chart]> {
        if !live.iter().any(|&v| v as usize >= self.charts.vertices) {
            return None;
        }
        Some(self.charts()).filter(|charts| !charts.is_empty())
    }
}
