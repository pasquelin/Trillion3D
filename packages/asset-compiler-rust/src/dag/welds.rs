//! What every reduction of a primitive reads beside its level's locks: the welds by position, by
//! position and texture coordinates and by everything a page stores, the seams, the islands and
//! the extents of the parts — computed once, grown with every vertex a solved reduction places.
use super::attributes::{seam_vertices, weld_exact};
use super::charts::vertex_islands;
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
    /// Its texture island, a placed vertex its origin's; empty without a texture set.
    pub islands: Vec<u32>,
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
                islands: vertex_islands(&weld_seam, indices),
                // Nothing carried, the exact key is the position key: the same weld.
                exact: match attributes.carried.is_empty() {
                    true => weld.clone(),
                    false => weld_exact(positions, attributes.carried, indices),
                },
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
            islands: &c.islands,
            source_vertices: self.positions.len() / 3,
            weld: &c.weld,
            exact: &c.exact,
            weld_seam: Some(&c.weld_seam[..])
                .filter(|w| !w.is_empty())
                .unwrap_or(&c.weld),
            extents: &c.extents,
        }
    }
    /// Appends what the level's welds say of the vertices a solved reduction placed, `shift`
    /// renumbering them after those already placed at the level.
    pub fn extend(&mut self, placed: Placed, shift: impl Fn(u32) -> u32) {
        let (to, from) = (&mut self.columns, placed.columns);
        to.weld.extend(from.weld.into_iter().map(&shift));
        to.weld_seam.extend(from.weld_seam.into_iter().map(&shift));
        to.exact.extend(from.exact.into_iter().map(&shift));
        to.seams.extend(from.seams);
        to.extents.extend(from.extents);
        to.islands.extend(from.islands);
    }
}
