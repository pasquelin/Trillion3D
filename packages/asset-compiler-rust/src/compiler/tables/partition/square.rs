//! The square hierarchical grid of the `spatialHash` scheme. A grid covers the world's spatially
//! loaded objects with a square centred on its origin — the world's, or the one the job sets the
//! main grid's at — a power of two of its cells wide: twice the cells the farthest bound lies from
//! the origin on the ground plane, rounded up to a power of two. Each level doubles the cell and
//! halves the cells per side, up to its top, one cell over the whole square; each level below the
//! top holds one cell more per side, centred on the origin too, so its edges pass between those of
//! the levels around it — unless the job nests the levels (`nestedLevels`): every edge of a cell
//! is then an edge of the cells it holds.
//!
//! An object whose ground box is no larger than a finest cell goes to the finest cell under its
//! centre, always loaded when none lies there (`smallByCentre`, the reference's default); any other
//! to the first level, from the one whose cell is as wide as its bounds, where its bounds meet one
//! cell alone. The top's one cell is the always loaded one: an object it alone holds is always
//! loaded, and no HLOD is built of it (`place`). A cell streams by its square on the plane, its
//! content's up axis kept (`streamed`): it loads while the view lies within its grid's range of
//! that square.
use super::grid::{ground, level_side, Coord, PLANE};
use super::Box6;
use crate::compiler::args::SquareSettings;

/// The most cells a side of a square grid's finest level holds, a power of two: far past any world
/// a cell side the job names may cut, and low enough that its cell coordinates stay whole numbers.
const MOST_CELLS: u64 = 1 << 40;

/// A square grid over the world: its finest cell's side, metres, its centre on the plane, the
/// cells per side of its finest level — a power of two, halved at each level up to its top's one —
/// and the job's settings of its scheme (`SquareSettings`).
#[derive(Clone, Copy, Debug)]
pub(crate) struct SquareGrid {
    pub cell: f64,
    origin: [f64; 2],
    cells: i64,
    settings: SquareSettings,
}

impl SquareGrid {
    /// The grid of cells of side `cell` centred on `origin` over `world`, the box around every
    /// spatially loaded object, under `settings`: as wide as the farthest its bounds lie from the
    /// origin along either axis of the plane; one level of one cell when the world is empty or on
    /// the origin.
    pub(crate) fn over(
        world: &Box6,
        cell: f64,
        origin: [f64; 2],
        settings: SquareSettings,
    ) -> Self {
        let (low, high) = ground(world);
        let reach = (0..2)
            .map(|a| (low[a] - origin[a]).abs().max((high[a] - origin[a]).abs()))
            .fold(0.0, f64::max);
        // Past 2^40 cells a side the levels outrun any world: a cell side that tiny is held there.
        let cells = if reach.is_finite() && reach > 0.0 {
            ((2.0 * (reach / cell).ceil()) as u64)
                .min(MOST_CELLS)
                .next_power_of_two() as i64
        } else {
            1
        };
        Self {
            cell,
            origin,
            cells,
            settings,
        }
    }

    /// Its centre on the plane, its finest level's cells per side, and whether a wished cell pulls
    /// in the coarser cells overlapping it — what the runtime finds them by: never while its
    /// levels nest, whose edges a coarser cell's never cross.
    pub(crate) fn geometry(&self) -> ([f64; 2], i64, bool) {
        let SquareSettings {
            nested_levels,
            pull_coarser,
            ..
        } = self.settings;
        (self.origin, self.cells, pull_coarser && !nested_levels)
    }

    /// Its levels, its top's one cell included.
    fn levels(&self) -> u32 {
        self.cells.trailing_zeros() + 1
    }

    /// The side of a cell of `level`.
    fn side(&self, level: u32) -> f64 {
        level_side(self.cell, level)
    }

    /// The cells per side of `level`: the finest level's halved at each level up, one more below
    /// the top unless the levels nest.
    fn count(&self, level: u32) -> i64 {
        let more = !self.settings.nested_levels && level + 1 < self.levels();
        (self.cells >> level) + i64::from(more)
    }

    /// The cell of `level` under `point`, unbounded.
    fn under(&self, point: [f64; 2], level: u32) -> [i64; 2] {
        let half = self.count(level) as f64 * 0.5;
        [0, 1].map(|a| ((point[a] - self.origin[a]) / self.side(level) + half).floor() as i64)
    }

    /// The first and last cells of `level` the plane's `(low, high)` meets, `None` when it meets
    /// none of the square.
    fn meets(&self, (low, high): ([f64; 2], [f64; 2]), level: u32) -> Option<([i64; 2], [i64; 2])> {
        let count = self.count(level);
        let (first, last) = (self.under(low, level), self.under(high, level));
        if first.iter().any(|&c| c >= count) || last.iter().any(|&c| c < 0) {
            return None;
        }
        let clamp = |c: [i64; 2]| c.map(|v| v.clamp(0, count - 1));
        Some((clamp(first), clamp(last)))
    }

    /// The cell `bounds` goes to: a small one's — its ground box no larger than a finest cell,
    /// when the job places those by their centre —, the finest cell under its centre; any other's,
    /// from the level whose cell is as wide as its widest side, the first where it meets one cell
    /// alone. `None` when that is the top — the always loaded cell — or no cell holds it.
    pub(crate) fn place(&self, bounds: &Box6) -> Option<Coord> {
        let plane = ground(bounds);
        let size = [0, 1].map(|a| plane.1[a] - plane.0[a]);
        let top = self.levels() - 1;
        let placed = if self.settings.small_by_centre && size[0] * size[1] <= self.cell * self.cell
        {
            let at = self.under([0, 1].map(|a| (plane.0[a] + plane.1[a]) / 2.0), 0);
            let count = self.count(0);
            at.iter().all(|c| (0..count).contains(c)).then_some((0, at))
        } else {
            let first = (size[0].max(size[1]) / self.cell).log2().ceil().max(0.0) as u32;
            (first..=top).find_map(|level| {
                let (low, high) = self.meets(plane, level)?;
                (low == high).then_some((level, low))
            })
        };
        placed
            .filter(|&(level, _)| level < top)
            .map(|(level, [x, z])| (level, [x, 0, z]))
    }

    /// The bounds cell `(level, at)` streams by: its square on the plane, `content`'s up axis.
    pub(crate) fn streamed(&self, (level, at): Coord, content: &Box6) -> Box6 {
        let side = self.side(level);
        let half = self.count(level) as f64 * side * 0.5;
        let mut bounds = *content;
        for (k, axis) in PLANE.into_iter().enumerate() {
            bounds[axis] = self.origin[k] - half + at[axis] as f64 * side;
            bounds[axis + 3] = bounds[axis] + side;
        }
        bounds
    }
}
