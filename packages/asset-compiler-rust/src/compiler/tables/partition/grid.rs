//! The partition's grids, one kind per scheme (`PartitionScheme`): the loose hierarchical grid of
//! `hashSet`, the reference's default (`loose.rs`), and the square hierarchical grid over the
//! world of `spatialHash` (`square.rs`). A grid is flat by default: a world spreads over the
//! ground, not up, so the bounds lose their up axis before they are placed, glTF's `+Y` (glTF 2.0,
//! "Coordinate System and Units"); a loose grid the job does not lay flat cuts height into cells
//! too. A cell is named by its level, then its coordinates on glTF's `x`, `y` and `z`, `y` 0 on a
//! flat grid.
//!
//! The main grid loads its cells within the loading range the job sets on cells of the side it
//! sets, on the origin it sets (`partitionGrid`, `PartitionGrid`: 256 m and 128 m by default);
//! each HLOD layer's actors stream on the grid of their layer's level (`../../../hlod/grids.rs`).
use super::loose::LooseGrid;
use super::square::SquareGrid;
use super::Box6;

/// The axes a flat grid keeps: all but glTF's up, `Y`.
pub(super) const PLANE: [usize; 2] = [0, 2];
/// The axes a grid that does not lie flat keeps: every one.
pub(super) const SPACE: [usize; 3] = [0, 1, 2];

/// A cell of a grid: its level, then its coordinates on glTF's `x`, `y` and `z`.
pub(crate) type Coord = (u32, [i64; 3]);

/// The side of a cell of `level` on a grid whose finest cell is `cell` wide: doubled at each level.
pub(super) fn level_side(cell: f64, level: u32) -> f64 {
    cell * 2f64.powi(level as i32)
}

/// `bounds` without its up axis, as a flat grid places it.
pub(super) fn ground(bounds: &Box6) -> ([f64; 2], [f64; 2]) {
    (
        PLANE.map(|axis| bounds[axis]),
        PLANE.map(|axis| bounds[axis + 3]),
    )
}

/// One grid of the partition, of its scheme's kind.
#[derive(Clone, Copy, Debug)]
pub(crate) enum CellGrid {
    Loose(LooseGrid),
    Square(SquareGrid),
}

impl CellGrid {
    /// Its finest cell's side, metres.
    pub(crate) fn cell(&self) -> f64 {
        match self {
            Self::Loose(grid) => grid.cell,
            Self::Square(grid) => grid.cell,
        }
    }

    /// The cell `bounds` goes to; `None` when it is always loaded, which a loose grid never says.
    pub(crate) fn place(&self, bounds: &Box6) -> Option<Coord> {
        match self {
            Self::Loose(grid) => Some(grid.place(bounds)),
            Self::Square(grid) => grid.place(bounds),
        }
    }

    /// The bounds cell `coord` streams by, `content` the box around what it holds: that box, its
    /// cell or both, or its square, as its kind says (`LooseGrid::streamed`,
    /// `SquareGrid::streamed`).
    pub(crate) fn streamed(&self, coord: Coord, content: &Box6) -> Box6 {
        match self {
            Self::Loose(grid) => grid.streamed(coord, content),
            Self::Square(grid) => grid.streamed(coord, content),
        }
    }

    /// Whether it lies flat on the ground: a square grid always does.
    pub(crate) fn flat(&self) -> bool {
        match self {
            Self::Loose(grid) => grid.flat,
            Self::Square(_) => true,
        }
    }

    /// A square grid's origin on the ground and its finest level's cells per side, which the
    /// runtime finds the coarser cells overlapping a wished cell by (`write.rs`, the root's
    /// `coarser`); none for a loose one, or a square one whose wished cells pull in none
    /// (`SquareGrid::geometry`).
    pub(crate) fn coarser(&self) -> Option<([f64; 2], i64)> {
        match self {
            Self::Loose(_) => None,
            Self::Square(grid) => {
                let (origin, cells, pulls) = grid.geometry();
                pulls.then_some((origin, cells))
            }
        }
    }
}
