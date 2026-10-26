//! The partition's grids: the main ones the job sets (`partitionGrid`, or `partitionGrids`: one
//! per entry, `PartitionGrid::grids`), then the grids the HLOD layers' actors stream on, each of
//! the partition's scheme (`PartitionScheme`, `../compiler/tables/partition/grid.rs`):
//!
//! - `hashSet`, the reference's default: one loose grid per HLOD level of each main grid that owns
//!   an object, its own chain, level `i`'s cell side and loading range those the job names it
//!   (`hlodGrids` of the main grid), each else that main grid's doubled `i + 1` times; on the main
//!   grid's origin, flat as it is, each finest cell streaming by its content clipped to its cell;
//!   its cells loaded at priority 0. The chain has grids for the layers the main grid lists
//!   (`hlodLayers`, every layer of the job's HLOD by default) and for those alone: an actor of
//!   another is always loaded, as one of a layer not spatially loaded. A layer's own `cellSize`
//!   and `loadingRange` set nothing, as the reference deprecates them. An actor lies in the cell
//!   its loose grid gives it (`LooseGrid::place`): no actor of a layer with grids is always
//!   loaded.
//! - `spatialHash`: the grid the layer names (`HlodLayer::cell_size`, `loading_range`), the layers
//!   of one level, cell side and loading range sharing one whichever main grid their objects
//!   stream on, each a square grid over the world centred on the world's origin, its cells loaded
//!   by priority `HLOD_GRID_PRIORITY` plus its level, after the main grids'. Every square grid
//!   takes the first grid's square settings, which are the whole partition's. An actor lies in the
//!   cell of its grid its bounds give it (`SquareGrid::place`); one no cell below its grid's top
//!   holds is always loaded.
//!
//! An actor built by a layer not spatially loaded is always loaded, on no grid.
use crate::compiler::args::{GridSettings, PartitionScheme, StreamBounds};
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

/// One grid of the partition: the rank of the main grid it belongs to — its own for a main grid,
/// none for a square HLOD grid, which every main grid shares —, its level — the HLOD level of the
/// actors it streams, 0 for a main grid —, its loading range, metres, the priority its cells load
/// by, the lower the sooner, whether a load blocks on its slow streaming — a main grid's as the
/// job names it, an HLOD grid's never —, and its grid, of the scheme's kind.
pub(crate) struct GridSpec {
    pub main: Option<usize>,
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

/// The partition's grids — the main ones first, then one per key a spatially loaded layer names,
/// in their order — and, for each main grid, the grid each layer's actors lie on.
pub(crate) struct Grids {
    pub list: Vec<GridSpec>,
    /// How many of the first grids are main ones.
    pub mains: usize,
    of_layer: Vec<Vec<Option<usize>>>,
}

/// The main grid `g` at rank `at`, of kind `kind`.
fn main_spec(g: &GridSettings, at: usize, kind: CellGrid) -> GridSpec {
    GridSpec {
        main: Some(at),
        level: 0,
        range: g.loading_range,
        priority: g.priority,
        blocks: g.block_on_slow_streaming,
        grid: kind,
    }
}

impl Grids {
    /// The job's main grids and the grids of `hlod`'s layers at their `levels` (`Hlod::levels`),
    /// of the job's scheme, an HLOD chain for each main grid `owning` names, those that own an
    /// object; a square grid spans `world`, the box around every node that may stream.
    pub(crate) fn of(
        (hlod, levels, grid): (&Hlod, &[Option<usize>], &PartitionGrid),
        world: &Box6,
        owning: impl Iterator<Item = usize>,
    ) -> Self {
        let mut owners = vec![false; grid.grids.len()];
        owning.for_each(|main| owners[main] = true);
        match grid.scheme {
            PartitionScheme::HashSet => Self::loose((hlod, levels), &grid.grids, &owners),
            PartitionScheme::SpatialHash => Self::square((hlod, levels), &grid.grids, world),
        }
    }

    /// The loose grids of `hashSet`: each of the main grids `all`, then its own HLOD level grids,
    /// for the layers it lists (`LooseSettings::lists`) when it owns an object (`owners`).
    fn loose(
        (hlod, levels): (&Hlod, &[Option<usize>]),
        all: &[GridSettings],
        owners: &[bool],
    ) -> Self {
        let loose = |g: &GridSettings, cell: f64, bounds: StreamBounds| {
            CellGrid::Loose(LooseGrid {
                cell,
                origin: g.origin,
                flat: g.loose.flat,
                bounds,
            })
        };
        let mains = (all.iter().enumerate())
            .map(|(at, g)| main_spec(g, at, loose(g, g.cell_size, g.loose.stream_bounds)))
            .collect();
        Self::keyed(
            (hlod, levels),
            mains,
            |main, l| owners[main] && all[main].loose.lists(&l.name),
            |main, _, level| (main, level),
            |(main, level)| {
                let g = &all[main];
                let scale = 2f64.powi(level as i32 + 1);
                let [cell, range] = (g.loose.hlod_grids.get(level).copied()).unwrap_or_default();
                GridSpec {
                    main: Some(main),
                    level,
                    range: range.unwrap_or(g.loading_range * scale),
                    priority: LOOSE_HLOD_PRIORITY,
                    blocks: false,
                    grid: loose(
                        g,
                        cell.unwrap_or(g.cell_size * scale),
                        StreamBounds::Clipped,
                    ),
                }
            },
        )
    }

    /// The square grids of `spatialHash` over `world`: each of the main grids `all`, then the HLOD
    /// grids the layers name, shared by every main grid, all under the first grid's settings.
    fn square(
        (hlod, levels): (&Hlod, &[Option<usize>]),
        all: &[GridSettings],
        world: &Box6,
    ) -> Self {
        let square = |cell: f64, origin: [f64; 2]| {
            CellGrid::Square(SquareGrid::over(world, cell, origin, all[0].square))
        };
        let mains = (all.iter().enumerate())
            .map(|(at, g)| {
                let origin = [g.origin[0], g.origin[2]];
                main_spec(g, at, square(g.cell_size, origin))
            })
            .collect();
        // Positive `f64`s order as their bits do: by level, then cell side, then range.
        let key = |_: usize, l: &HlodLayer, level: usize| {
            (level, l.cell_size.to_bits(), l.loading_range.to_bits())
        };
        // Its HLOD grids are the layers', whichever main grid owns an object: every chain
        // reaches them.
        Self::keyed(
            (hlod, levels),
            mains,
            |_, _| true,
            key,
            |(level, cell, range)| GridSpec {
                main: None,
                level,
                range: f64::from_bits(range),
                priority: HLOD_GRID_PRIORITY + level as u32,
                blocks: false,
                grid: square(f64::from_bits(cell), [0.0, 0.0]),
            },
        )
    }

    /// `mains`, then one grid per key `key` gives a spatially loaded layer of `hlod` at its level
    /// (`levels`) in the chain of a main grid, where `has` says the chain has grids for the layer,
    /// in the keys' order, each as `spec` makes it; each main grid's layers' actors on the grid of
    /// their key, none for a layer not spatially loaded, without grids on that main grid, or no
    /// object's chain reaches.
    fn keyed<K: Ord + Copy>(
        (hlod, levels): (&Hlod, &[Option<usize>]),
        mains: Vec<GridSpec>,
        has: impl Fn(usize, &HlodLayer) -> bool,
        key: impl Fn(usize, &HlodLayer, usize) -> K,
        spec: impl Fn(K) -> GridSpec,
    ) -> Self {
        let count = mains.len();
        let rows: Vec<Vec<Option<K>>> = (0..count)
            .map(|main| {
                (hlod.layers.iter().zip(levels))
                    .map(|(l, level)| {
                        let level = (*level)?;
                        (l.spatially_loaded && has(main, l)).then(|| key(main, l, level))
                    })
                    .collect()
            })
            .collect();
        let keys: BTreeSet<K> = rows.iter().flatten().flatten().copied().collect();
        let at: BTreeMap<K, usize> = (keys.iter().enumerate())
            .map(|(rank, &k)| (k, count + rank))
            .collect();
        let mut list = mains;
        list.extend(keys.iter().map(|&k| spec(k)));
        let of_layer: Vec<Vec<Option<usize>>> = (rows.iter())
            .map(|row| row.iter().map(|k| k.map(|k| at[&k])).collect())
            .collect();
        Self {
            list,
            mains: count,
            of_layer,
        }
    }

    /// Main grid `at`.
    pub(crate) fn main(&self, at: usize) -> &GridSpec {
        &self.list[at]
    }

    /// Where an actor of layer `layer`, in the chain of main grid `main`, bounded by `bounds` lies:
    /// its grid and its cell there; `None` when it is always loaded — its layer not spatially
    /// loaded, or no cell below its grid's top holding it whole.
    pub(crate) fn place(&self, main: usize, layer: usize, bounds: &Box6) -> Option<(usize, Coord)> {
        let grid = self.of_layer[main][layer]?;
        Some((grid, self.list[grid].place(bounds)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The partition `job` names.
    fn read(job: Value) -> std::result::Result<PartitionGrid, String> {
        PartitionGrid::read(job.as_object().expect("a job"))
    }

    #[test]
    fn a_main_grid_has_grids_for_the_layers_it_lists_and_for_those_alone() {
        let hlod = crate::tests::fixtures::hlod_chain();
        let job = json!({"partitionGrids": [{}, {"name": "far", "hlodLayers": ["hlod0"]}]});
        let grid = read(job).expect("reads");
        assert_eq!(grid.unknown_hlod_layer(&hlod), None);
        let levels = hlod.levels([0]);
        let grids = Grids::of((&hlod, &levels, &grid), &[0.0; 6], [0, 1].into_iter());
        // The first grid lists every layer: hlod0 to hlod2 have grids, hlod3 is not spatially
        // loaded. The second lists hlod0 alone.
        assert_eq!(grids.list.len(), 2 + 3 + 1);
        let on = |main, layer| {
            grids
                .place(main, layer, &[1.0, 0.0, 1.0, 2.0, 1.0, 2.0])
                .is_some()
        };
        assert_eq!(
            [0, 1, 2, 3].map(|layer| on(0, layer)),
            [true, true, true, false]
        );
        assert_eq!(
            [0, 1, 2, 3].map(|layer| on(1, layer)),
            [true, false, false, false]
        );
    }

    #[test]
    fn a_layer_no_job_layer_bears_or_a_square_scheme_refuses_the_list() {
        let hlod = crate::tests::fixtures::hlod_chain();
        let wrong = read(json!({"partitionGrid": {"hlodLayers": ["nowhere"]}})).expect("reads");
        let refusal = wrong.unknown_hlod_layer(&hlod).expect("refused");
        assert!(
            refusal.contains("partitionGrid") && refusal.contains("nowhere"),
            "{refusal}"
        );
        let square = json!({"partitionScheme": "spatialHash", "partitionGrid": {"hlodLayers": []}});
        assert!(read(square).expect_err("refused").contains("hashSet alone"));
        assert!(read(json!({"partitionGrid": {"hlodLayers": [3]}})).is_err());
    }
}
