//! The HLOD cells of the main grid's cells, the HLOD chain: at level 0, each main cell's objects
//! of one layer make one HLOD actor of that layer — the job's `instanced` layers, the source
//! meshes themselves, batched —, bounded by its objects' bounds and placed on the HLOD 0 grid; at
//! each next level, each cell of the grid below makes one HLOD actor of its layer's parent layer,
//! placed on that level's grid — cell and range doubled each level, each actor standing in twice as
//! far as the cells it replaces. An HLOD actor is hidden while the cell its sources stream in is
//! shown, so the two never draw the same ground: an HLOD `l` cell is the source cell of its HLOD
//! `l + 1` actor, and that actor loads while the HLOD `l + 1` cell it lies in is shown.
//!
//! Each object follows its layer's chain of parents (`Hlod`): chains of different layers build
//! distinct cells and actors over the same ground, one per layer and cell, and end at different
//! levels. A cell whose layer's parent is a chain's top makes that top's actor, placed on no grid
//! and always loaded: wherever nothing finer is shown, a chain's top is, and the world stays drawn
//! to the horizon. A cell streams by its content's bounds, not its grid cell's, so an object
//! overrunning its loose cell is loaded before the view reaches it.
use super::grid::{self, Coord};
use super::split::GridCell;
use super::*;
use crate::Hlod;

/// One HLOD cell of the chain — a cell of the HLOD `level` grid —: the bounds it streams by on that
/// grid — shown within its range, the HLOD `level + 1` actor made of it hidden (`actor_level`) —,
/// the HLOD `level + 1` cell that actor lies in (`parent`), `None` for a cell whose actor is its
/// chain's top, always loaded, and the rank of the job's HLOD layer it is a cell of (`layer`; its
/// actor is built by that layer's parent) — `None` for a cell of objects in no layer, a leaf that never
/// rises: nothing stands for them beyond its range. Leaves — layer 0, the HLOD 0 cells — come
/// first, then each level's cells in turn.
#[derive(Clone, Debug)]
pub(crate) struct HlodNode {
    pub parent: Option<usize>,
    pub level: usize,
    pub layer: Option<usize>,
    pub shown: Box6,
}

impl HlodNode {
    /// The HLOD level of the actor its sources make: its own level's next.
    pub(crate) fn actor_level(&self) -> usize {
        self.level + 1
    }
}

/// The cells of `contents` — each its HLOD layer and its box — placed on the HLOD `level` grid,
/// one per layer and grid cell: per content its cell's rank, and each cell's layer and content, in
/// the order of their layers and coordinates.
fn placed_on(
    contents: &[(Option<usize>, Box6)],
    level: usize,
) -> (Vec<usize>, Vec<(Option<usize>, Box6)>) {
    let (side, _) = grid::hlod_grid(level);
    let mut cells: BTreeMap<(Option<usize>, Coord), Box6> = BTreeMap::new();
    let keys: Vec<(Option<usize>, Coord)> = contents
        .iter()
        .map(|(layer, content)| {
            let key = (*layer, grid::place(content, side));
            grow_flat(cells.entry(key).or_insert(EMPTY_FLAT), content);
            key
        })
        .collect();
    let rank: BTreeMap<(Option<usize>, Coord), usize> =
        cells.keys().enumerate().map(|(r, c)| (*c, r)).collect();
    let ranks = keys.iter().map(|key| rank[key]).collect();
    (
        ranks,
        cells
            .into_iter()
            .map(|((layer, _), b)| (layer, b))
            .collect(),
    )
}

/// The HLOD 0 cell of each of `cells`, by rank, and the chain's cells (`HlodNode`), leaves first,
/// each level up for the cells whose layer's parent builds actors that have a parent of their own.
pub(super) fn hlod_cells(cells: &[GridCell], hlod: &Hlod) -> (Vec<usize>, Vec<HlodNode>) {
    let contents: Vec<(Option<usize>, Box6)> = cells.iter().map(|c| (c.layer, c.content)).collect();
    // Level 0: one HLOD 0 actor per main cell and layer, bounded by its content, on the HLOD 0 grid.
    let (leaf_of, mut level_cells) = placed_on(&contents, 0);
    let mut nodes: Vec<HlodNode> = Vec::new();
    let (mut first, mut level) = (0, 0);
    while !level_cells.is_empty() {
        nodes.extend(level_cells.iter().map(|&(layer, content)| HlodNode {
            parent: None,
            level,
            layer,
            // A cell streams by its content's bounds, which a loose cell's objects may overrun.
            shown: content,
        }));
        // The next level: one actor per cell here whose layer's parent has a parent of its own —
        // else that actor is its chain's top, placed on no grid —, its cell its parent layer's.
        let rising: Vec<(usize, (Option<usize>, Box6))> = (level_cells.iter().enumerate())
            .filter_map(|(at, &(layer, content))| {
                let parent = hlod.layers[layer?].parent?;
                hlod.layers[parent].parent?;
                Some((at, (Some(parent), content)))
            })
            .collect();
        let here: Vec<(Option<usize>, Box6)> = rising.iter().map(|(_, cell)| *cell).collect();
        let (parent_of, next) = placed_on(&here, level + 1);
        let base = first + level_cells.len();
        for ((at, _), parent) in rising.iter().zip(parent_of) {
            nodes[first + at].parent = Some(base + parent);
        }
        first = base;
        level_cells = next;
        level += 1;
    }
    (leaf_of, nodes)
}
