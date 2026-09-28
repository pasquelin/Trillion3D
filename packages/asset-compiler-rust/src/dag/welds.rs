//! What every reduction of a primitive reads beside its level's locks: the welds by position, by
//! position and texture coordinates and by everything a page stores, the seams, the charts and
//! the extents of the parts — computed once, grown with every vertex a solved reduction places.
use super::attributes::{seam_vertices, weld_exact};
use super::charts::{vertex_charts, Chart};
use super::clusters::{normalized_bits, position_key};
use super::clusters::{weld_positions, weld_positions_and_uv};
use super::grown::Placed;
use super::{DagAttributes, GroupReductionInput};
use crate::geometry_page::Attribute as Carried;
use crate::qem::Attribute;

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
    /// Its chart (`charts::vertex_charts`), a placed vertex its origin's; empty without a texture
    /// set.
    pub charts: Vec<Chart>,
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
        self.charts.extend(other.charts);
    }
}

/// What every reduction of a primitive reads beside its level's locks, computed once.
/// Grown with every vertex a solved reduction places (`grown::Placed`).
pub(super) struct Welds<'a> {
    /// The source's positions and carried attributes, which the grown arrays start from.
    pub positions: &'a [f32],
    pub attributes: DagAttributes<'a>,
    columns: Columns,
}
impl<'a> Welds<'a> {
    pub fn of(positions: &'a [f32], attributes: DagAttributes<'a>, indices: &[u32]) -> Self {
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
            positions,
            attributes,
            columns: Columns {
                charts: vertex_charts(&weld, &weld_seam, &uv_sets, indices),
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
    /// The input of one reduction over the level's vertex arrays, its carried attributes and those
    /// the simplifier weighs of them; `normal_bound` is its group's (`quality::deviation_bound`).
    pub fn input<'b>(
        &'b self,
        positions: &'b [f32],
        carried: &'b [&'b Carried],
        weighted: &'b [Attribute<'b>],
        locks: &'b [bool],
        normal_bound: f64,
    ) -> GroupReductionInput<'b> {
        let c = &self.columns;
        GroupReductionInput {
            positions,
            attributes: DagAttributes { carried },
            weighted,
            normal_bound,
            locks,
            seams: &c.seams,
            charts: &c.charts,
            source_vertices: self.positions.len() / 3,
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
    /// The charts, when `live` names a vertex a solve placed and the primitive has a texture set.
    pub(super) fn placed_charts(&self, live: &[u32]) -> Option<&'a [Chart]> {
        let placed = live.iter().any(|&v| v as usize >= self.source_vertices);
        Some(self.charts).filter(|charts| placed && !charts.is_empty())
    }
}
