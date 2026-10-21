//! What every reduction of a primitive reads beside its group's border: the welds by position, by
//! position and texture coordinates and by everything the build carries — computed once over the
//! arrays as the build reads them (`input.rs`), grown with every vertex a solved reduction places.
use super::attributes::{weld_exact, weld_refined};
use super::clusters::{first_uses, position_key, weld_by};
use super::DagAttributes;
use crate::simplify;
use trillion3d_page_codec::encode::Attribute;

/// What one group's reduction reads of its level (`Welds::input`).
pub(super) struct GroupReductionInput<'a> {
    /// The level's vertex arrays: the source's, then every vertex a solved reduction placed.
    pub positions: &'a [f32],
    /// Every attribute the build carries; normals and texture sets count in the error.
    pub attributes: DagAttributes<'a>,
    /// Those the simplifier weighs (`DagAttributes::weighted`), built once per level.
    pub weighted: &'a [simplify::Attribute<'a>],
    /// Canonical vertex by position: locks, borders, adjacency.
    pub weld: &'a [u32],
    /// Canonical vertex by position and every carried attribute (`attributes::weld_exact`).
    pub exact: &'a [u32],
    /// Canonical vertex by position and every texture set: the diagnosis's census.
    pub weld_seam: &'a [u32],
    /// What every solve keeps beside its target (`SolveRules`).
    pub rules: simplify::SolveRules,
}

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

/// What every reduction of a primitive reads beside its group's border, computed once.
/// Grown with every vertex a solved reduction places (`grown::Placed`).
pub(super) struct Welds {
    columns: Columns,
}
impl Welds {
    /// The welds of the vertices `indices` name over `positions` and `attributes`, the arrays as
    /// the build reads them.
    pub fn of(positions: &[f32], attributes: DagAttributes, indices: &[u32]) -> Self {
        // Each vertex's first use, read by every weld below.
        let first = first_uses(positions.len() / 3, indices);
        let weld = weld_by(&first, |id| position_key(positions, id));
        // Refined by no texture set, the weld stays the position weld.
        let uvs: Vec<(&[f32], usize)> = (attributes.uv_sets().into_iter())
            .map(|uv| (uv, 2))
            .collect();
        let weld_seam = weld_refined(&weld, &uvs, &first);
        Self {
            columns: Columns {
                // The seam weld refined by what else the build carries.
                exact: weld_exact(&weld_seam, attributes.carried, &first),
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
    /// the simplifier weighs of them, under `rules`.
    pub fn input<'b>(
        &'b self,
        positions: &'b [f32],
        carried: &'b [&'b Attribute],
        weighted: &'b [simplify::Attribute<'b>],
        rules: simplify::SolveRules,
    ) -> GroupReductionInput<'b> {
        let c = &self.columns;
        GroupReductionInput {
            positions,
            attributes: DagAttributes { carried },
            weighted,
            weld: &c.weld,
            exact: &c.exact,
            weld_seam: &c.weld_seam,
            rules,
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
