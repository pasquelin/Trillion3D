//! The partition's grids: the main one the job sets (`partitionGrid`, `PartitionGrid`), then the
//! grids the HLOD layers' actors stream on, each of the partition's scheme (`PartitionScheme`,
//! `../compiler/tables/partition/grid.rs`):
//!
//! - `hashSet`, the reference's default: one loose grid per HLOD level, level `i`'s cell side and
//!   loading range those the job names it (`partitionGrid.hlodGrids`), each else the main grid's
//!   doubled `i + 1` times; on the main grid's origin, flat as it is, each finest cell streaming
//!   by its content clipped to its cell; its cells loaded at priority 0. A layer's own `cellSize`
//!   and `loadingRange` set nothing, as the reference deprecates them. An actor lies in the cell
//!   its loose grid gives it (`LooseGrid::place`): no actor of a spatially loaded layer is always
//!   loaded.
//! - `spatialHash`: the grid the layer names (`HlodLayer::cell_size`, `loading_range`), the layers
//!   of one level, cell side and loading range sharing one, each a square grid over the world
//!   centred on the world's origin under the main grid's settings of its scheme, its cells loaded
//!   by priority `HLOD_GRID_PRIORITY` plus its level, after the main grid's. An actor lies in the
//!   cell of its grid its bounds give it (`SquareGrid::place`); one no cell below its grid's top
//!   holds is always loaded.
//!
//! An actor built by a layer not spatially loaded is always loaded, on no grid.
use crate::compiler::args::{PartitionScheme, StreamBounds};
use crate::compiler::tables::partition::grid::{CellGrid, Coord};
use crate::compiler::tables::partition::loose::LooseGrid;
use crate::compiler::tables::partition::square::SquareGrid;
use crate::compiler::tables::partition::Box6;
use crate::*;

/// The priority a square HLOD grid's cells load by, plus its level: after the main grid's by
/// default.
const HLOD_GRID_PRIORITY: u32 = 100;
/// The priority a loose HLOD grid's cells load by: the reference's HLOD partitions', which no
/// setting changes.
const LOOSE_HLOD_PRIORITY: u32 = 0;

/// One grid of the partition: its level — the HLOD level of the actors it streams, 0 for the main
/// grid —, its loading range, metres, the priority its cells load by, the lower the sooner,
/// whether a load blocks on its slow streaming — the main grid's as the job names it, an HLOD
/// grid's never —, and its grid, of the scheme's kind.
pub(crate) struct GridSpec {
    pub level: usize,
    pub range: f64,
    pub priority: u32,
    pub blocks: bool,
    pub grid: CellGrid,
}

impl GridSpec {
    /// The cell of this grid `bounds` goes to, `None` when always loaded (`CellGrid::place`).
    pub(crate) fn place(&self, bounds: &Box6) -> Option<Coord> {
        self.grid.place(bounds)
    }
}

/// The partition's grids — the main one first, then one per key a spatially loaded layer names,
/// in their order — and the grid each layer's actors lie on.
pub(crate) struct Grids {
    pub list: Vec<GridSpec>,
    of_layer: Vec<Option<usize>>,
}

impl Grids {
    /// The job's main `grid` and the grids of `hlod`'s layers at their `levels` (`Hlod::levels`),
    /// of the job's scheme; a square grid spans `world`, the box around every node that may
    /// stream.
    pub(crate) fn of(
        (hlod, levels, grid): (&Hlod, &[Option<usize>], &PartitionGrid),
        world: &Box6,
    ) -> Self {
        let main = |kind: CellGrid| GridSpec {
            level: 0,
            range: grid.loading_range,
            priority: grid.priority,
            blocks: grid.block_on_slow_streaming,
            grid: kind,
        };
        match grid.scheme {
            PartitionScheme::HashSet => {
                let loose = |cell: f64, bounds: StreamBounds| {
                    CellGrid::Loose(LooseGrid {
                        cell,
                        origin: grid.origin,
                        flat: grid.loose.flat,
                        bounds,
                    })
                };
                let main = main(loose(grid.cell_size, grid.loose.stream_bounds));
                Self::keyed(
                    (hlod, levels),
                    main,
                    |_, level| level,
                    |level| {
                        let scale = 2f64.powi(level as i32 + 1);
                        let [cell, range] =
                            (grid.loose.hlod_grids.get(level).copied()).unwrap_or_default();
                        GridSpec {
                            level,
                            range: range.unwrap_or(grid.loading_range * scale),
                            priority: LOOSE_HLOD_PRIORITY,
                            blocks: false,
                            grid: loose(
                                cell.unwrap_or(grid.cell_size * scale),
                                StreamBounds::Clipped,
                            ),
                        }
                    },
                )
            }
            PartitionScheme::SpatialHash => {
                let square = |cell: f64, origin: [f64; 2]| {
                    CellGrid::Square(SquareGrid::over(world, cell, origin, grid.square))
                };
                let main = main(square(grid.cell_size, [grid.origin[0], grid.origin[2]]));
                // Positive `f64`s order as their bits do: by level, then cell side, then range.
                let key = |l: &HlodLayer, level: usize| {
                    (level, l.cell_size.to_bits(), l.loading_range.to_bits())
                };
                Self::keyed((hlod, levels), main, key, |(level, cell, range)| GridSpec {
                    level,
                    range: f64::from_bits(range),
                    priority: HLOD_GRID_PRIORITY + level as u32,
                    blocks: false,
                    grid: square(f64::from_bits(cell), [0.0, 0.0]),
                })
            }
        }
    }

    /// `main`, then one grid per key `key` gives a spatially loaded layer of `hlod` at its level
    /// (`levels`), in the keys' order, each as `spec` makes it; each layer's actors on the grid of
    /// its key, none for a layer not spatially loaded or no object's chain reaches.
    fn keyed<K: Ord + Copy>(
        (hlod, levels): (&Hlod, &[Option<usize>]),
        main: GridSpec,
        key: impl Fn(&HlodLayer, usize) -> K,
        spec: impl Fn(K) -> GridSpec,
    ) -> Self {
        let key_of = |(l, level): (&HlodLayer, &Option<usize>)| {
            Some(key(l, (*level)?)).filter(|_| l.spatially_loaded)
        };
        let keys: BTreeSet<K> = (hlod.layers.iter().zip(levels))
            .filter_map(key_of)
            .collect();
        let mut list = vec![main];
        list.extend(keys.iter().map(|&k| spec(k)));
        let of_layer = (hlod.layers.iter().zip(levels))
            .map(|layer| {
                let key = key_of(layer)?;
                Some(1 + keys.iter().position(|k| *k == key)?)
            })
            .collect();
        Self { list, of_layer }
    }

    /// The main grid.
    pub(crate) fn main(&self) -> &GridSpec {
        &self.list[0]
    }

    /// Where an actor of layer `layer` bounded by `bounds` lies: its grid and its cell there;
    /// `None` when it is always loaded — its layer not spatially loaded, or no cell below its
    /// grid's top holding it whole.
    pub(crate) fn place(&self, layer: usize, bounds: &Box6) -> Option<(usize, Coord)> {
        let grid = self.of_layer[layer]?;
        Some((grid, self.list[grid].place(bounds)?))
    }
}
