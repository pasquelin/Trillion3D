//! The world partition of the node table: every object of the scene — a node drawing a mesh,
//! shown, carrying no camera — is spatially loaded unless its settings say otherwise
//! (`ObjectSettings`, `spatiallyLoaded`): its cell draws it, and the runtime streams that cell by
//! distance to its camera. Which nodes may stream, how their cells draw them, and the batches the
//! objects attached under one another stream in are `candidates.rs`'s.
//!
//! An object that moves, itself or through a node above it, takes no HLOD layer — past its cell's
//! range nothing stands for it —, nor does an instanced skinned object its mobility lets move. What
//! stays in the core — every node a cell does not place, the ranks renumbered without the placed
//! ones (`kept.rs`) — is always there; an instanced skinned object the core keeps hangs under its
//! skin's frame at no pose, naming its item (`"bank"`, `hang_banks`).
//!
//! The cells are those of the grids of the job's scheme (`grid.rs`, `PartitionScheme`): every
//! batch in the cell of the main grid it streams on — the one its root's `runtimeGrid` names among
//! those the job sets (`partitionGrid`, or `partitionGrids`, `PartitionGrid`), the first for none —
//! the box around its objects' world boxes goes to (`partition/split.rs`) — on the square grids of
//! `spatialHash`, a batch no cell below the main grid's top holds whole is always loaded, in the
//! core, as are objects whose instanced layer's HLOD 0 actor no cell of its grid holds
//! (`streams_in_cell`) —, and the chain of HLOD cells its objects' actors lie in, on the grids of
//! their layers (`../../hlod/cells.rs`, `../../hlod/grids.rs`). An object's world box is its
//! mesh's under its world matrix, its morph targets' offsets included (`boxes.rs`); an instanced
//! skinned object's its item's sampled bounds at its skin frame's world, a plain skinned one's the
//! bounds of every clip moving its skin at that world (`motion/bank.rs`). A cell file carries, for
//! each core parent its nodes hang under, the box around them in that parent's frame, and the
//! world bounds its grid cell streams by and its HLOD 0 cell's — on `hashSet`'s loose grids the
//! box around their content, on `spatialHash`'s their squares —, which the runtime tests against
//! those grids' loading ranges, written in the root with every grid and the scheme (`write.rs`);
//! the chain itself is the world HLOD's table's (`hlod/chain.rs`). A scene with no placed
//! node — or whose job turns the streaming off — is not partitioned: its table is the one it was,
//! all of it always there. The cells' records are paged (`pages.rs`): the core keeps a root of
//! fixed size.
use super::*;
use crate::compiler::source::node_transform::Mat4;

pub(crate) mod boxes;
mod candidates;
pub(crate) mod grid;
mod kept;
pub(crate) mod loose;
pub(crate) mod pages;
mod scene;
pub(crate) mod split;
pub(crate) mod square;
mod write;
use super::motion::bank::Banks;
pub(crate) use crate::hlod::cells::{hlod_cells, streams_in_cell, HlodNode};
pub(crate) use crate::hlod::grids::Grids;
use candidates::{gather, Candidate, Gathered, Row};
use grid::Coord;
use kept::{core_nodes, core_ranks, hang_banks};
use pages::MeshSlots;
use scene::hierarchy;
pub(crate) use split::{grid_cells, main_cells, GridCell, Placed, Region};
pub(crate) use trillion3d_math::geometry::aabb::{grow_flat, EMPTY_FLAT};
use write::write_cells;

/// A box, `[minX, minY, minZ, maxX, maxY, maxZ]`.
pub(crate) type Box6 = [f64; 6];

/// The input scene a partition reads: its glTF document, its binary and each input mesh's box.
type InputScene<'a> = (&'a Value, &'a [u8], &'a [Option<Box6>]);

/// Version of a page and of the root the core carries, one more with several main grids
/// (`pages::GRIDS_CELL_PAGES`); `docs/FORMAT.md` (World partition) tells what each changed.
const PARTITION_VERSION: u32 = 13;
/// Version of a cell file; what each version changed is told in `docs/FORMAT.md` (World partition).
const CELL_VERSION: u32 = 3;

/// The published nodes each cell file places, by file rank — an animated object of the core its
/// cell draws among them —; each file's HLOD 0 cell — none for objects in no layer —, and the whole
/// chain of HLOD cells, those first (`hlod/cells.rs`): what the world's HLOD layers are built over
/// (`hlod/chain.rs`). `banked`, the instanced skinned objects the cells place, each with its
/// item and skin frame: their rows play their track; one marked `hlodInstance` stands above. With
/// them, the compile's warnings: each placed node whose mark won over a rule naming another
/// layer — its node, the mark's layer and the rule's (`Assigned`) —; each node marked that no HLOD
/// takes — it moves, itself or through a node above it, or is not spatially loaded or in a batch
/// with one that is not, hidden, held whole by no cell below a grid's top, or turned away by its
/// layer's size filter —; each node its settings make an instanced skinned object that stays a
/// plain skinned one, with why (`bank_warnings`: the bake's refusals, `Banks::refused`, then the
/// partition's); and each batch root whose `runtimeGrid` no grid bears (`unknown_grids`).
#[derive(Default)]
pub(crate) struct CellMembers {
    pub nodes: Vec<Vec<usize>>,
    pub hlod: Vec<Option<usize>>,
    pub tree: Vec<HlodNode>,
    pub banked: BTreeMap<usize, (usize, Option<usize>)>,
    pub overruled: Vec<(usize, usize, usize)>,
    pub unplaced: Vec<usize>,
    pub bank_warnings: Vec<(usize, String)>,
    pub unknown_grids: Vec<(usize, String)>,
}

/// The box of the HLOD 0 actor of each layer in each main cell, by main grid, cell and layer: the
/// box around the world boxes of the `candidates` the layer takes (`assigned`) there, in the cell
/// (`coords`) their batch's box goes to.
fn actor_boxes(
    candidates: &[Candidate],
    (coords, assigned): (&[Option<Coord>], &[Assigned]),
) -> BTreeMap<(usize, Coord, usize), Box6> {
    let mut actors = BTreeMap::new();
    for ((coord, assigned), candidate) in coords.iter().zip(assigned).zip(candidates) {
        if let (Some(coord), Some(layer)) = (coord, assigned.layer) {
            let key = (candidate.grid, *coord, layer);
            boxes::grown(&mut actors, key, &candidate.world);
        }
    }
    actors
}

/// The core the runtime reads first, the root of the cells it reads by distance, and their count.
pub(crate) struct Partitioned {
    pub nodes: Vec<Value>,
    pub roots: Vec<usize>,
    pub partition: Value,
    pub cells: usize,
    /// Each node's rank in the core, `None` for one a cell places in its stead.
    pub rank: Vec<Option<usize>>,
}

/// The core and the cells of `table`, or `None` when it places no node, and the published nodes
/// each cell places with their HLOD cells (`CellMembers`), each node in the cells of the HLOD layer
/// `hlod` assigns it (`assignments`, read once for the job: `Hlod::assignments`), none for one that
/// moves (`Candidate::still`). `objects` says which objects are spatially loaded
/// (`ObjectSettings`); `banks`, the instanced skinned objects and the items they play
/// (`motion/bank.rs`); `source`, its binary and its meshes' boxes, the input scene a plain skinned
/// object's bounds are sampled from (`gather`). The grids — the job's main `grid`, then the HLOD
/// layers', of the job's scheme — span the world of the nodes that may stream (`Grids::of`), each
/// batch in the main cell its box goes to on its main grid (`Candidate::grid`): a batch no cell
/// below the main grid's top holds whole, or objects whose instanced layer's HLOD 0 actor in their
/// cell no cell of its grid holds (`streams_in_cell`), are always loaded, kept in the core; each
/// layer's grid at the level the objects' layers give it (`Hlod::levels`); with the streaming off
/// (`PartitionGrid::streams`), every node is. An HLOD that assigns a layer to no placed object
/// that may take one refuses the job. `files` is the folder the cells' files are written in, and
/// the job's pool that writes them side by side. Whether the scene is partitioned or not, `table` and `roots` come back with each
/// instanced skinned object the core keeps hung under its skin's frame (`hang_banks`), and each
/// animated object a cell draws saying so (`"streamed"`).
pub(crate) fn partition(
    (g, worlds): (&Value, &[Mat4]),
    (hlod, assignments, grid): (&crate::Hlod, &[Assigned], &crate::PartitionGrid),
    (objects, banks, (source, bin, source_boxes)): (&crate::ObjectSettings, &Banks, InputScene<'_>),
    (table, roots): (&mut [Value], &mut Vec<usize>),
    mesh_pages: &MeshSlots,
    files: (&Path, &rayon::ThreadPool),
) -> Result<(Option<Partitioned>, CellMembers)> {
    let (parent, reached) = hierarchy(table, roots)?;
    let Gathered {
        candidates,
        batches,
        bankable,
        bank_warnings,
        unknown_grids,
    } = gather(
        (g, worlds),
        (grid, objects, banks),
        (source, bin, source_boxes),
        table,
        (&parent, &reached),
    )?;
    // An instanced layer's size filter turns away an object whose world box falls short of it —
    // never an instanced skinned object, which the filter does not see —, and an object that moves
    // takes no layer: neither enters an HLOD (`HlodSizeFilter`). Each object's `hlodInstance`
    // switch must read, whichever layer it takes.
    let mut turned = BTreeSet::new();
    let assigned: Vec<Assigned> = (candidates.iter())
        .map(|candidate| {
            let mut assigned = assignments[candidate.node];
            crate::hlod::options::instanced(g, candidate.node)?;
            let b = &candidate.world;
            let world = ([b[0], b[1], b[2]], [b[3], b[4], b[5]]);
            let skinned = matches!(candidate.row, Row::Track { .. });
            let admits = |l: &usize| skinned || hlod.layers[*l].size_filter.admits(world);
            if candidate.still && assigned.layer.is_some_and(|l| !admits(&l)) {
                turned.insert(candidate.node);
            }
            assigned.layer = assigned.layer.filter(|l| candidate.still && admits(l));
            Ok(assigned)
        })
        .collect::<Result<_>>()?;
    let mut world = EMPTY_FLAT;
    candidates
        .iter()
        .for_each(|c| grow_flat(&mut world, &c.world));
    // Each layer's level, from the layers the objects take (`Hlod::levels`).
    let levels = hlod.levels(assigned.iter().filter_map(|a| a.layer));
    let grids = Grids::of(
        (hlod, &levels, grid),
        &world,
        candidates.iter().map(|c| c.grid),
    );
    // Each one's main cell on its main grid, its batch's — `None` at a square grid's top —; and
    // each main cell's HLOD 0 actor of each layer.
    let coords: Vec<Option<Coord>> = (candidates.iter())
        .map(|c| grids.main(c.grid).place(&batches[&c.batch]))
        .collect();
    let actors = actor_boxes(&candidates, (&coords, &assigned));
    // A node streams in its main cell unless its instanced layer's actor there is always loaded.
    let streams = |k: usize| {
        let main = candidates[k].grid;
        coords[k].is_some_and(|coord| {
            let actor = |l: usize| (l, &actors[&(main, coord, l)]);
            (assigned[k].layer).is_none_or(|l| streams_in_cell(hlod, &grids, main, actor(l)))
        })
    };
    let placed_ids: Vec<usize> = (0..candidates.len()).filter(|&k| streams(k)).collect();
    // The nodes a cell draws. The core keeps every node but those a cell places in its stead —
    // an object it draws under its own node among them —, renumbered in order.
    let drawn: BTreeMap<usize, &Candidate> = (placed_ids.iter())
        .map(|&k| (candidates[k].node, &candidates[k]))
        .collect();
    let rank = core_ranks(table.len(), &drawn);
    // Every mark was read with the assignments, a placed node's or not: one naming no group nor
    // layer refuses the job. A marked node no HLOD takes — the core keeps it, it moves, or its
    // layer's size filter turns it away — is told.
    let mut unplaced = Vec::new();
    let untaken = |id: &usize| drawn.get(id).is_none_or(|c| !c.still) || turned.contains(id);
    for id in (0..table.len()).filter(untaken) {
        if crate::compiler::args::marked(g, id) {
            unplaced.push(id);
        }
    }
    let mut placed = Vec::with_capacity(placed_ids.len());
    let mut overruled = Vec::new();
    for &k in &placed_ids {
        let (candidate, assigned) = (&candidates[k], assigned[k]);
        let id = candidate.node;
        if let (Some(layer), Some(ruled)) = (assigned.layer, assigned.overruled) {
            overruled.push((id, layer, ruled));
        }
        let (core_parent, entry) = candidate.entry(table, &parent, &rank);
        let bytes = serde_json::to_vec(&entry)?.len() + 1;
        placed.push(Placed {
            node: id,
            layer: assigned.layer,
            bounds: candidate.world,
            grid: candidate.grid,
            cell: coords[k].expect("a streaming node's cell"),
            parent: core_parent,
            local: candidate.local,
            entry,
            bytes,
        });
    }
    // Only an object that may take a layer tells an HLOD that names none.
    let layered = placed_ids.iter().any(|&k| candidates[k].still);
    if !hlod.layers.is_empty() && layered && placed.iter().all(|p| p.layer.is_none()) {
        return Err(crate::compiler::validate::OPTIONS.bad(format!(
            "{HLOD_FIELD} assigns no placed object a layer: mark objects (extras.{HLOD_MARK}) or \
             name them by groups or rules"
        )));
    }
    // The animated objects a cell draws stream; the instanced skinned objects no cell places stay
    // in the core, hung under their skin's frame.
    let streamed: Vec<usize> = (drawn.values())
        .filter(|c| matches!(c.row, Row::Source))
        .map(|c| c.node)
        .collect();
    let track = |c: &&Candidate| match c.row {
        Row::Track { item, frame } => Some((c.node, (item, frame))),
        _ => None,
    };
    let banked: BTreeMap<_, _> = (drawn.values()).filter_map(track).collect();
    let kept_banks: Vec<(usize, usize, Option<usize>)> = (bankable.into_iter())
        .filter(|(id, ..)| !drawn.contains_key(id))
        .collect();
    hang_banks(table, roots, &parent, &kept_banks);
    for id in streamed {
        table[id]["streamed"] = json!(true);
    }
    let mut members = CellMembers {
        banked,
        overruled,
        unplaced,
        bank_warnings,
        unknown_grids,
        ..CellMembers::default()
    };
    if placed.is_empty() {
        return Ok((None, members));
    }
    let nodes = core_nodes(table, &rank, &drawn);
    let roots = roots.iter().filter_map(|id| rank[*id]).collect();
    let mains = main_cells(placed);
    let (leaf_of, tree) = hlod_cells(&mains, hlod, &grids);
    let (cells, tree_of) = grid_cells(mains, &leaf_of, &grids);
    for cell in &cells {
        for (h, file) in &cell.files {
            members.nodes.push(file.iter().map(|p| p.node).collect());
            members.hlod.push(*h);
        }
    }
    let split = Some(Partitioned {
        nodes,
        roots,
        cells: members.nodes.len(),
        partition: write_cells((&cells, &tree_of), (&tree, &grids, grid), mesh_pages, files)?,
        rank,
    });
    members.tree = tree;
    Ok((split, members))
}
