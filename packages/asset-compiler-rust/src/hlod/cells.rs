//! The HLOD chain over the main grid's cells. At level 0, each main
//! cell's objects of one layer make one HLOD actor of that layer, bounded by its objects' bounds
//! and placed on its layer's grid: an `instanced` layer's, the source meshes themselves — their
//! own cell rows, loaded within that grid's range —; any other layer's, built of them by its
//! builder and first drawn past the main grid's range. Each cell of a grid then makes one actor
//! per layer its actors name as their parent (`HlodNode::actor`), bounded by the actors it
//! is made of and placed on that layer's grid, and so on up each chain. An HLOD actor is hidden
//! while the cell its sources stream in is shown: a cell is the source cell of its actor, and that
//! actor loads with the cell it lies in.
//!
//! Every layer that streams its actors lies on a grid of the partition's scheme (`grids.rs`). An
//! actor built by a layer not spatially loaded, or that no cell of its grid holds, is always
//! loaded, and nothing is built of it: a chain's top. So is the top of a chain whose last layer
//! streams its actors: past that grid's range, nothing stands for them. Each object follows its
//! layer's chain of parents (`Hlod`): a cell holds the actors of every layer on its grid, and
//! makes one actor per layer they name as their parent — layers of one parent share their actor,
//! those of two parents build two.
pub(crate) use super::grids::Grids;
use crate::compiler::tables::partition::boxes::grown;
use crate::compiler::tables::partition::grid::Coord;
use crate::compiler::tables::partition::split::MainCell;
use crate::compiler::tables::partition::*;
use crate::*;
use std::ops::Bound::{Excluded, Unbounded};

/// One HLOD cell of the chain: the cell its actor lies in (`parent`), `None` for an actor always
/// loaded or a cell nothing is built of; its level as the world table writes it — 0 for an HLOD 0
/// cell, whose placements it draws (`HlodNode::level`) —; its grid (`Grids::list`) and the level
/// of its cell on that grid (`rung`), which its load order reads first; the rank of the job's
/// layer that builds its actor (`actor`), none for a cell of a chain's last grid, nothing built of
/// it, and that actor's HLOD level (`actor_level`); whether that actor asks a warm-up before a
/// switch draws it — every builder's but `instanced`'s, whose actor is the source meshes
/// themselves —; the bounds it streams by, as its grid's kind says (`CellGrid::streamed`), shown
/// within its grid's range, its actor hidden; the distance its actor is first drawn from — that
/// range, past which the cell goes —; and the union of what it holds. The HLOD 0 cells come
/// first, then each level's.
///
/// An HLOD 0 cell holds a main cell's objects: of a layer not instanced, one cell per main cell
/// and layer, on the main grid and streamed as that main cell is, its actor the layer's HLOD 0
/// actor, built of those objects and first drawn from the main grid's range; of an instanced
/// layer, the objects of every main cell its HLOD 0 actor — those objects themselves, their cell
/// rows — lies in a cell of the layer's grid, the cell of that grid, its actor its parent's. A
/// cell above holds actors: level 1 at least, the HLOD level of the actors in it otherwise.
#[derive(Clone, Debug)]
pub(crate) struct HlodNode {
    pub parent: Option<usize>,
    pub level: usize,
    pub grid: usize,
    pub rung: u32,
    pub actor: Option<usize>,
    pub actor_level: usize,
    pub warmup: bool,
    pub shown: Box6,
    pub seen_from: f64,
    pub content: Box6,
}

/// A cell of the chain as it is found: its level, its grid, its cell there, and the layer that
/// builds its actor — ordered so, a cell comes after every cell whose actor lies in it.
type Key = (usize, usize, Coord, Option<usize>);

/// The rank of the main grid in `Grids::list`, its first: the grid an HLOD 0 cell of a layer not
/// instanced lies on.
const MAIN_GRID: usize = 0;

/// Whether the objects of layer `layer` in a main cell stream in that cell, `actor` the bounds of
/// their HLOD 0 actor there: always, but an instanced layer's while that actor — the objects
/// themselves — lies in no cell of its grid, always loaded: they stay in the core, the same image.
pub(crate) fn streams_in_cell(hlod: &Hlod, grids: &Grids, (layer, actor): (usize, &Box6)) -> bool {
    hlod.layers[layer].builder != HlodBuilder::Instanced || grids.place(layer, actor).is_some()
}

/// Per main cell of `mains`, the HLOD 0 cell each of its layers' objects lie in, and the chain's
/// cells on `grids` (`HlodNode`), the HLOD 0 cells first, then each level's: each main cell's
/// objects of each layer in an HLOD 0 cell — a cell of the main grid of their own for a layer not
/// instanced, its actor built by that layer, else the cell of the layer's grid their actor lies in
/// (`Grids::place`), built further by the layer's parent —; then each cell's actor, bounded by
/// what the cell holds, in a cell of its layer's grid while it streams there, built further by
/// that layer's parent, up each chain. A layer's grid lies above the grids of the layers below it
/// (`Hlod::levels`): each cell is found whole before its actor is placed. Every instanced layer's
/// placed objects' actor streams: one always loaded keeps its objects in the core
/// (`streams_in_cell`).
pub(crate) fn hlod_cells(
    mains: &[MainCell],
    hlod: &Hlod,
    grids: &Grids,
) -> (Vec<BTreeMap<usize, usize>>, Vec<HlodNode>) {
    let mut contents: BTreeMap<Key, Box6> = BTreeMap::new();
    // The bounds an HLOD 0 cell of a layer not instanced streams by: its main cell's.
    let mut streamed: BTreeMap<Key, Box6> = BTreeMap::new();
    // The cell of actors an actor of `layer` bounded by `bounds` lies in, built further by its
    // parent.
    let keyed = |layer: usize, bounds: &Box6| {
        let (grid, coord) = grids.place(layer, bounds)?;
        Some((
            grids.list[grid].level.max(1),
            grid,
            coord,
            hlod.layers[layer].parent,
        ))
    };
    let leaf_keys: Vec<BTreeMap<usize, Key>> = (mains.iter())
        .map(|main| {
            let (mut actors, mut whole) = (BTreeMap::<usize, Box6>::new(), EMPTY_FLAT);
            for node in &main.nodes {
                grow_flat(&mut whole, &node.bounds);
                if let Some(layer) = node.layer {
                    grown(&mut actors, layer, &node.bounds);
                }
            }
            (actors.into_iter())
                .map(|(layer, bounds)| {
                    let key = match hlod.layers[layer].builder {
                        HlodBuilder::Instanced => {
                            let (grid, coord) = (grids.place(layer, &bounds))
                                .expect("an instanced layer's placed objects' actor streams");
                            (0, grid, coord, hlod.layers[layer].parent)
                        }
                        _ => {
                            let key = (0, MAIN_GRID, main.coord, Some(layer));
                            streamed.insert(key, grids.main().grid.streamed(main.coord, &whole));
                            key
                        }
                    };
                    grown(&mut contents, key, &bounds);
                    (layer, key)
                })
                .collect()
        })
        .collect();
    // Each cell's actor, made of what it holds, in the cell of its layer's grid it lies in —
    // `None`: always loaded, nothing built of it.
    let mut parents: BTreeMap<Key, Option<Key>> = BTreeMap::new();
    let mut next = contents.keys().next().copied();
    while let Some(key) = next {
        let content = contents[&key];
        let up = key.3.and_then(|layer| keyed(layer, &content));
        if let Some(up) = up {
            grown(&mut contents, up, &content);
        }
        parents.insert(key, up);
        next = (contents.range((Excluded(key), Unbounded)).next()).map(|(k, _)| *k);
    }
    let rank: BTreeMap<Key, usize> = (contents.keys().enumerate())
        .map(|(r, k)| (*k, r))
        .collect();
    let nodes = (contents.iter())
        .map(|(key, content)| {
            let &(level, grid, coord, actor) = key;
            let spec = &grids.list[grid];
            HlodNode {
                parent: parents[key].map(|up| rank[&up]),
                level,
                grid,
                rung: coord.0,
                actor,
                // A main cell's actor is HLOD 0; one built of a cell of a grid, the next level.
                actor_level: if grid == MAIN_GRID { 0 } else { spec.level + 1 },
                warmup: actor.is_some_and(|l| hlod.layers[l].builder != HlodBuilder::Instanced),
                shown: (streamed.get(key).copied())
                    .unwrap_or_else(|| spec.grid.streamed(coord, content)),
                seen_from: spec.range,
                content: *content,
            }
        })
        .collect();
    let leaf_of = (leaf_keys.iter())
        .map(|keys| {
            keys.iter()
                .map(|(&layer, key)| (layer, rank[key]))
                .collect()
        })
        .collect();
    (leaf_of, nodes)
}
