//! The loose hierarchical grid of the `hashSet` scheme, the reference's default. An object goes to
//! the level whose cell is as wide as its widest side — on the ground for a flat grid —, its side
//! over the finest cell's rounded up to a power of two; one level finer while it overruns that
//! finer cell, the one under its centre, by less than a quarter of the finest cell on every side —
//! that quarter in whole centimetres, as the reference divides its integer side —; and to the cell
//! under its centre there (`place`). A cell's objects may thus pass its edges — a loose cell —, and
//! no level tops the grid: every spatially loaded object streams, however wide.
//!
//! A cell of the finest level streams by the bounds its grid says (`StreamBounds`): the box around
//! its content, its cell's box — of unbounded height on a flat grid —, or the first clipped to the
//! second; a coarser one by its content (`streamed`). The main grid's say what the job sets, an
//! HLOD grid's the clipped content, as the reference bounds the cells of its HLOD partitions.
use super::grid::{level_side, Coord, PLANE, SPACE};
use super::Box6;
use crate::compiler::args::StreamBounds;

/// Half the height of a flat grid's cell box, metres: the reference's half world, so a cell's box
/// holds whatever lies above or below it.
const UNBOUNDED_HALF_HEIGHT: f64 = 43_980_465_111.04;

/// A loose grid: its finest cell's side, metres, its origin — a cell's low corner, glTF's `x`, `y`
/// and `z` —, whether it lies flat on the ground, and the bounds a cell of its finest level
/// streams by.
#[derive(Clone, Copy, Debug)]
pub(crate) struct LooseGrid {
    pub cell: f64,
    pub origin: [f64; 3],
    pub flat: bool,
    pub bounds: StreamBounds,
}

impl LooseGrid {
    /// The axes it cuts into cells: the ground's when flat, every one otherwise.
    fn axes(&self) -> &'static [usize] {
        if self.flat {
            &PLANE
        } else {
            &SPACE
        }
    }

    /// The side of a cell of `level`.
    fn side(&self, level: u32) -> f64 {
        level_side(self.cell, level)
    }

    /// The cell of `level` under `point`, 0 on an axis it does not cut.
    fn under(&self, point: [f64; 3], level: u32) -> [i64; 3] {
        let side = self.side(level);
        let mut at = [0; 3];
        for &a in self.axes() {
            at[a] = ((point[a] - self.origin[a]) / side).floor() as i64;
        }
        at
    }

    /// The low corner of cell `(level, at)`.
    fn corner(&self, (level, at): Coord) -> [f64; 3] {
        let side = self.side(level);
        [0, 1, 2].map(|a| self.origin[a] + at[a] as f64 * side)
    }

    /// A quarter of the finest cell, metres: in whole centimetres, as the reference divides its
    /// integer side.
    fn margin(&self) -> f64 {
        ((self.cell * 100.0).round() as i64 / 4) as f64 / 100.0
    }

    /// The cell `bounds` goes to: the level whose cell is as wide as its widest side on the axes
    /// it cuts, one finer while it overruns the finer cell under its centre by less than a quarter
    /// of the finest cell, and the cell under its centre there.
    pub(crate) fn place(&self, bounds: &Box6) -> Coord {
        let axes = self.axes();
        let mut centre = [0.0; 3];
        for &a in axes {
            centre[a] = (bounds[a] + bounds[a + 3]) / 2.0;
        }
        let widest = axes
            .iter()
            .map(|&a| bounds[a + 3] - bounds[a])
            .fold(0.0, f64::max);
        let mut level = (widest / self.cell).log2().max(0.0).ceil() as u32;
        if level > 0 {
            let finer = (level - 1, self.under(centre, level - 1));
            let (min, side) = (self.corner(finer), self.side(level - 1));
            let overrun = (axes.iter())
                .map(|&a| {
                    (min[a] - bounds[a])
                        .max(bounds[a + 3] - (min[a] + side))
                        .max(0.0)
                })
                .fold(0.0, f64::max);
            if overrun < self.margin() {
                level -= 1;
            }
        }
        (level, self.under(centre, level))
    }

    /// The bounds cell `coord` streams by: on the finest level, as the grid's `bounds` say — the
    /// box around its `content`, its cell's box, or the first clipped to the second —; on a
    /// coarser one, the box around its content.
    pub(crate) fn streamed(&self, coord: Coord, content: &Box6) -> Box6 {
        if coord.0 != 0 || self.bounds == StreamBounds::Content {
            return *content;
        }
        let (min, side) = (self.corner(coord), self.side(0));
        let mut cell = [0.0; 6];
        for a in 0..3 {
            let cut = self.axes().contains(&a);
            cell[a] = if cut { min[a] } else { -UNBOUNDED_HALF_HEIGHT };
            cell[a + 3] = if cut {
                min[a] + side
            } else {
                UNBOUNDED_HALF_HEIGHT
            };
        }
        if self.bounds == StreamBounds::Cell {
            return cell;
        }
        let mut clipped = *content;
        for a in 0..3 {
            clipped[a] = clipped[a].max(cell[a]);
            clipped[a + 3] = clipped[a + 3].min(cell[a + 3]);
        }
        clipped
    }
}
