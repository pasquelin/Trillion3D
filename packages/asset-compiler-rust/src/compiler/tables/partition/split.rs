//! How placed nodes are grouped into cells: the main grid's (`grid.rs`), every node in the cell
//! its batch's box goes to (`CellGrid::place`), whatever its HLOD layer — a cell holds all its
//! objects, read and let go together. Within a cell, the objects of each HLOD 0 cell their
//! layer's actor lies in are written apart, and a group whose records pass one stream unit
//! (`STREAM_BUNDLE_BYTES`) is packed into several files: each file names its HLOD 0 cell, and they
//! all share their grid cell. The grid cells are then halved at the median of their centres, on
//! the axis of least cost (`split::bisect_least_cost`, every tree's split), for the paged cell
//! index alone (`pages.rs`): the index is cut from that tree.
use super::grid::{CellGrid, Coord};
use super::*;
use std::ops::Range;
use trillion3d_math::geometry::aabb::centre;
use trillion3d_page_codec::split::bisect_least_cost;

/// One placed node: its rank in the published scene, the HLOD layer it is assigned to
/// (`Hlod::assigned`, `None`: none), its world box, its main grid cell, the core rank of its
/// parent (`None`: a scene root) and its box in that parent's frame, its descriptor as the cell
/// writes it, and that descriptor's size.
pub(crate) struct Placed {
    pub node: usize,
    pub layer: Option<usize>,
    pub bounds: [f64; 6],
    pub cell: Coord,
    pub parent: Option<usize>,
    pub local: [f64; 6],
    pub entry: Value,
    pub bytes: usize,
}

/// One cell of the main grid and the nodes placed in it, of every layer.
pub(crate) struct MainCell {
    pub coord: Coord,
    pub nodes: Vec<Placed>,
}

/// The main grid's cells of `placed`, each with its nodes, in the order of their coordinates.
pub(crate) fn main_cells(placed: Vec<Placed>) -> Vec<MainCell> {
    let mut by_cell: BTreeMap<Coord, Vec<Placed>> = BTreeMap::new();
    for node in placed {
        by_cell.entry(node.cell).or_default().push(node);
    }
    (by_cell.into_iter())
        .map(|(coord, nodes)| MainCell { coord, nodes })
        .collect()
}

/// A node of the halving tree: its contiguous range of cells, and its halves unless it is one.
pub(crate) struct Region {
    pub cells: Range<usize>,
    pub halves: Option<Box<[Region; 2]>>,
}

/// The halving of `records` in order, in two down to single records: the tree of records that have
/// no place to halve by, as the manifest's primitives, or the files of one grid cell.
pub(crate) fn halving(records: Range<usize>) -> Region {
    let middle = records.start + records.len() / 2;
    let halves = (records.len() > 1)
        .then(|| Box::new([halving(records.start..middle), halving(middle..records.end)]));
    Region {
        cells: records,
        halves,
    }
}

/// One cell of the main grid as it is written: its coordinates, the bounds it streams by — the box
/// around its content, its cell's or both, or its square with its content's up axis, as its grid
/// says (`CellGrid::streamed`) —, the union of its nodes' world boxes,
/// and its nodes in files of at most one stream unit each, every file naming the HLOD 0 cell its
/// objects' actor lies in (`None`: objects in no layer).
pub(crate) struct GridCell {
    pub coord: Coord,
    pub bounds: Box6,
    pub content: Box6,
    pub files: Vec<(Option<usize>, Vec<Placed>)>,
}

/// `nodes` in files of at most `STREAM_BUNDLE_BYTES`, in order; a node larger alone in its own.
fn packed(nodes: Vec<Placed>) -> Vec<Vec<Placed>> {
    let mut files: Vec<Vec<Placed>> = vec![Vec::new()];
    let mut bytes = 0;
    for node in nodes {
        let last = files.last_mut().expect("a file");
        if !last.is_empty() && bytes + node.bytes > crate::STREAM_BUNDLE_BYTES {
            files.push(Vec::new());
            bytes = 0;
        }
        bytes += node.bytes;
        files.last_mut().expect("a file").push(node);
    }
    files
}

/// Halves the grid cells `ids` at the median of their centres on the axis of least cost, down to
/// one grid cell, whose files are halved in order; `first` is the rank of the first file. Returns
/// the tree; `order` takes the grid cells in its order.
fn halve(
    ids: &mut [usize],
    (cells, centres): (&[GridCell], &[[f64; 3]]),
    first: usize,
    order: &mut Vec<usize>,
) -> Region {
    if let [one] = ids {
        order.push(*one);
        return halving(first..first + cells[*one].files.len());
    }
    let corners = |id: usize| {
        let b = &cells[id].content;
        ([b[0], b[1], b[2]], [b[3], b[4], b[5]])
    };
    let at = ids.len() / 2;
    bisect_least_cost(ids, centres, corners, at);
    let (lower, upper) = ids.split_at_mut(at);
    let low = halve(lower, (cells, centres), first, order);
    let high = halve(upper, (cells, centres), low.cells.end, order);
    Region {
        cells: first..high.cells.end,
        halves: Some(Box::new([low, high])),
    }
}

/// The cells of `mains` on the main grid `grid` as they are written, in the order of the tree that
/// halves them, each its files in order, file after file the cells the runtime ranks; and that
/// tree, over the files. `leaf_of` gives, per main cell, the HLOD 0 cell each layer's actor lies
/// in (`hlod::cells::hlod_cells`).
pub(crate) fn grid_cells(
    mains: Vec<MainCell>,
    leaf_of: &[BTreeMap<usize, usize>],
    grid: &CellGrid,
) -> (Vec<GridCell>, Region) {
    let mut cells: Vec<GridCell> = (mains.into_iter().zip(leaf_of))
        .map(|(MainCell { coord, nodes }, leaves)| {
            let mut content = EMPTY_FLAT;
            nodes
                .iter()
                .for_each(|node| grow_flat(&mut content, &node.bounds));
            let mut groups: BTreeMap<Option<usize>, Vec<Placed>> = BTreeMap::new();
            for node in nodes {
                let leaf = node.layer.map(|layer| leaves[&layer]);
                groups.entry(leaf).or_default().push(node);
            }
            let files = (groups.into_iter())
                .flat_map(|(leaf, nodes)| packed(nodes).into_iter().map(move |file| (leaf, file)))
                .collect();
            GridCell {
                coord,
                bounds: grid.streamed(coord, &content),
                content,
                files,
            }
        })
        .collect();
    let mut ids: Vec<usize> = (0..cells.len()).collect();
    let mut order = Vec::with_capacity(cells.len());
    let centres: Vec<[f64; 3]> = (cells.iter())
        .map(|cell| {
            let b = &cell.content;
            centre([b[0], b[1], b[2]], [b[3], b[4], b[5]])
        })
        .collect();
    let tree = halve(&mut ids, (&cells, &centres), 0, &mut order);
    let mut slots: Vec<Option<GridCell>> = cells.drain(..).map(Some).collect();
    let ordered = order
        .into_iter()
        .map(|id| slots[id].take().expect("each grid cell once"))
        .collect();
    (ordered, tree)
}
