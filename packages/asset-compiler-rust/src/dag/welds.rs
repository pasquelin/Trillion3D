//! What every reduction of a primitive reads beside its level's locks: the welds by position, by
//! position and texture coordinates and by everything a page stores — computed once, grown with
//! every vertex a solved reduction places.
use super::attributes::{weld_exact, weld_refined};
use super::clusters::weld_positions;
use super::{DagAttributes, GroupReductionInput};
use crate::qem;
use trillion3d_page_codec::encode::Attribute;

/// One entry per vertex of the level for each question the welds answer; the source's first,
/// then every vertex a solved reduction placed.
#[derive(Default)]
pub(super) struct Columns {
    /// Canonical vertex by position.
    pub weld: Vec<u32>,
    /// Canonical vertex by position and every texture set: the position weld without one.
    pub weld_seam: Vec<u32>,
    /// Canonical vertex by position and every carried attribute (`weld_exact`).
    pub exact: Vec<u32>,
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
        // Refined by no texture set, the weld stays the position weld.
        let uvs: Vec<(&[f32], usize)> = (attributes.uv_sets().into_iter())
            .map(|uv| (uv, 2))
            .collect();
        let weld_seam = weld_refined(&weld, &uvs, indices);
        Self {
            positions,
            attributes,
            columns: Columns {
                // The seam weld refined by what else the pages carry.
                exact: weld_exact(&weld_seam, attributes.carried, indices),
                weld,
                weld_seam,
            },
        }
    }
    /// Canonical vertex by position, per vertex of the level.
    pub fn weld(&self) -> &[u32] {
        &self.columns.weld
    }
    /// The input of one reduction over the level's vertex arrays, its carried attributes and those
    /// the simplifier weighs of them.
    pub fn input<'b>(
        &'b self,
        positions: &'b [f32],
        carried: &'b [&'b Attribute],
        weighted: &'b [qem::Attribute<'b>],
        locks: &'b [bool],
    ) -> GroupReductionInput<'b> {
        let c = &self.columns;
        GroupReductionInput {
            positions,
            attributes: DagAttributes { carried },
            weighted,
            locks,
            weld: &c.weld,
            exact: &c.exact,
            weld_seam: &c.weld_seam,
        }
    }
    /// Appends what the level's welds say of the vertices a solved reduction placed, `shift`
    /// renumbering them after those already placed at the level.
    pub fn extend(&mut self, from: Columns, shift: impl Fn(u32) -> u32) {
        let to = &mut self.columns;
        to.weld.extend(from.weld.into_iter().map(&shift));
        to.weld_seam.extend(from.weld_seam.into_iter().map(&shift));
        to.exact.extend(from.exact.into_iter().map(&shift));
    }
}
