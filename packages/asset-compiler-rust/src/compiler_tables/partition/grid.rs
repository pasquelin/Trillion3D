//! The loose hierarchical grid: an object goes to the level whose cells hold its bounds — one level
//! finer while it overruns that finer cell by less than a quarter cell, a loose cell's margin — and
//! to the cell under its centre there, so a large object is streamed with the range of a large
//! cell and a small one with a small cell's. Every grid is 2D: a world spreads over the ground, not
//! up, so the bounds lose their up axis before they are placed, glTF's `+Y` (glTF 2.0, "Coordinate
//! System and Units"). The origin is the world's.
//!
//! The partition: the main grid loads its cells within `MAIN_LOADING_RANGE` = 256 m on cells of
//! half that range; HLOD layer `i`, from 0, gets a grid of cell `MAIN_CELL · (2 << i)` and range
//! `MAIN_LOADING_RANGE · (2 << i)`: each layer stands in twice as far as the one below.
use super::Box6;

/// The axes a 2D grid keeps: all but glTF's up, `Y`.
const PLANE: [usize; 2] = [0, 2];

/// The main partition's loading range, metres.
pub(crate) const MAIN_LOADING_RANGE: f64 = 256.0;
/// The main partition's cell side: half its loading range.
pub(crate) const MAIN_CELL: f64 = MAIN_LOADING_RANGE / 2.0;
/// HLOD layer `layer`'s grid: its cell side and loading range, `· (2 << layer)` the main ones.
pub(crate) fn hlod_grid(layer: usize) -> (f64, f64) {
    let scale = f64::from(2u32 << layer);
    (MAIN_CELL * scale, MAIN_LOADING_RANGE * scale)
}

/// A cell of a 2D loose hierarchical grid: its level, then its coordinates on the plane's two
/// axes.
pub(crate) type Coord = (i32, [i64; 2]);

/// `bounds` without its up axis, as a 2D grid places it.
fn flat(bounds: &Box6) -> ([f64; 2], [f64; 2]) {
    (
        PLANE.map(|axis| bounds[axis]),
        PLANE.map(|axis| bounds[axis + 3]),
    )
}

/// The cell of side `cell·2^level` under `point`.
fn coords(point: [f64; 2], cell: f64, level: i32) -> [i64; 2] {
    let side = cell * f64::powi(2.0, level);
    point.map(|p| (p / side).floor() as i64)
}

/// The cell `bounds` goes to on the 2D grid of side `cell`: its level, then the cell under its
/// centre there.
pub(crate) fn place(bounds: &Box6, cell: f64) -> Coord {
    let (low, high) = flat(bounds);
    let centre = [0, 1].map(|a| (low[a] + high[a]) / 2.0);
    let longest = (0..2).map(|a| high[a] - low[a]).fold(0.0, f64::max);
    let mut level = (longest / cell).log2().max(0.0).ceil() as i32;
    if level > 0 {
        let finer = coords(centre, cell, level - 1);
        let side = cell * f64::powi(2.0, level - 1);
        let under = (0..2)
            .map(|a| {
                let min = finer[a] as f64 * side;
                (min - low[a]).max(high[a] - (min + side)).max(0.0)
            })
            .fold(0.0, f64::max);
        if under < cell / 4.0 {
            level -= 1;
        }
    }
    (level, coords(centre, cell, level))
}
