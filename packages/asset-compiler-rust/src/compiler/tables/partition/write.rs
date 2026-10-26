//! What the partition writes: one file per cell file, the pages of their records (`pages.rs`), and
//! the root the core carries — its region pages, the partition's scheme, which the runtime tests
//! and ranks its cells by, and every grid.
use super::pages::{write_pages, MeshSlots, CELL_PAGES, GRIDS_CELL_PAGES};
use super::*;

/// The bit of a grid's flags in the root saying a load blocks on its slow streaming
/// (`GridSpec::blocks`, `PartitionGrid.blocks`).
const GRID_BLOCKS: u32 = 1;
/// The bit of a grid's flags in the root saying cell files stream on it: each main grid, and each
/// grid an HLOD 0 cell lies on (`HlodNode::grid`) — an instanced layer's, whatever its HLOD level
/// —, the range its files are placed within (`PartitionGrid.files`).
const GRID_FILES: u32 = 2;
/// The bit of a grid's flags in the root saying it lies flat unlike the root's `flat`, the first
/// grid's: a job whose grids all lie flat, or none does, sets none (`PartitionGrid.flat`).
const GRID_FLAT_UNLIKE: u32 = 4;

/// Writes one file per cell file and the pages of their records, and returns the root the core
/// carries, its region pages naming the `mesh_pages` their cells use, the partition's scheme
/// (`PartitionGrid::scheme`) and the grids (`Grids`). A record is the file's address, fingerprint,
/// size, its box in the frame of each core parent it hangs nodes under, how many nodes of each
/// mesh it places — what the runtime sizes its rows by before its first frame —, its main grid
/// cell — its level, then its coordinates on glTF's `x` and `z`, or `x`, `y`, `z` on a grid that
/// does not lie flat — and the world bounds that cell streams by, the rank of the main grid it
/// lies on when that is not the first (`main`), and its HLOD 0 cell with the bounds that cell
/// streams by, its grid and the level of its cell there (`HlodNode`), or none for objects in no
/// layer; the index pages it by the bounds holding both. The root adds whether the first grid
/// lies flat, every grid — the main ones first, how many they are (`mains`) when more than one,
/// the pages then of the next version —, what each square grid whose wished cells pull in the
/// coarser ones overlapping them finds those by (`CellGrid::coarser`), and the HLOD 0 cells'
/// count.
pub(super) fn write_cells(
    (cells, tree): (&[GridCell], &Region),
    (hlod, grids, partition): (&[HlodNode], &Grids, &crate::PartitionGrid),
    (mesh_pages, unplaced): (&MeshSlots, &[u64]),
    (directory, pool): (&Path, &rayon::ThreadPool),
) -> Result<Value> {
    // Every cell file in the tree's order, `rank` its place: each is written apart, on the job's
    // workers.
    let placed: Vec<(&GridCell, Option<usize>, &[Placed])> = (cells.iter())
        .flat_map(|cell| (cell.files.iter()).map(move |(h, file)| (cell, *h, file.as_slice())))
        .collect();
    let written = pool.install(|| {
        (placed.par_iter().enumerate())
            .map(|(rank, &file)| cell_file(rank, file, (hlod, grids), directory))
            .collect::<Result<Vec<_>>>()
    })?;
    let (records, bounds): (Vec<Value>, Vec<Box6>) = written.into_iter().unzip();
    // Several main grids are pages of the next version: a runtime that reads one grid refuses them.
    let kind = if grids.mains > 1 {
        &GRIDS_CELL_PAGES
    } else {
        &CELL_PAGES
    };
    let mut root = write_pages(kind, tree, &records, &bounds, mesh_pages, directory)?;
    // The meshes only actors place are listed with no node (`unplaced_rows`).
    let listed = (root["meshes"].as_array_mut()).expect("the root lists its meshes");
    listed.extend(
        super::pages::unplaced_rows(unplaced)
            .into_iter()
            .map(Value::from),
    );
    // The HLOD 0 cells' count, in eight hexadecimal digits too.
    let leaves = hlod.iter().filter(|node| node.level == 0).count();
    let (listed, coarser) = grid_words(cells, hlod, grids);
    root["scheme"] = json!(partition.scheme.name());
    root["flat"] = json!(grids.main(0).grid.flat());
    root["hlod"] = json!({"grids": listed, "cells": format!("{:08x}", leaves), "coarser": coarser});
    if grids.mains > 1 {
        root["hlod"]["mains"] = json!(grids.mains);
    }
    Ok(root)
}

/// The root's lists of the grids, fixed width as every other list of it: per grid the bits of its
/// cell side and of its loading range as `f64`s in sixteen hexadecimal digits each, then its
/// priority, its HLOD level and its flags (`GRID_BLOCKS`, `GRID_FILES`, `GRID_FLAT_UNLIKE`) in
/// eight each, cell files streaming on the grids the HLOD 0 cells `hlod` lie on and the main grids
/// of `cells`; and per grid whose wished cells pull in the coarser ones overlapping them, the bits
/// of its origin on the ground as `f64`s in sixteen hexadecimal digits each, then its finest
/// level's cells per side in eight, none for any other grid.
fn grid_words(cells: &[GridCell], hlod: &[HlodNode], grids: &Grids) -> (Vec<String>, Vec<Value>) {
    let leaves = hlod
        .iter()
        .filter(|node| node.level == 0)
        .map(|node| node.grid);
    let files: BTreeSet<usize> = leaves.chain(cells.iter().map(|cell| cell.grid)).collect();
    let flat = grids.main(0).grid.flat();
    let listed: Vec<String> = (grids.list.iter().enumerate())
        .map(|(at, grid)| {
            let (cell, range) = (grid.grid.cell().to_bits(), grid.range.to_bits());
            let blocks = if grid.blocks { GRID_BLOCKS } else { 0 };
            let unlike = if grid.grid.flat() != flat {
                GRID_FLAT_UNLIKE
            } else {
                0
            };
            let flags = blocks | unlike | if files.contains(&at) { GRID_FILES } else { 0 };
            format!(
                "{cell:016x}{range:016x}{:08x}{:08x}{flags:08x}",
                grid.priority, grid.level
            )
        })
        .collect();
    let coarser: Vec<Value> = (grids.list.iter())
        .map(|grid| {
            let ([x, z], cells) = grid.grid.coarser()?;
            Some(format!(
                "{:016x}{:016x}{cells:08x}",
                x.to_bits(),
                z.to_bits()
            ))
        })
        .map(|grid| grid.map_or(Value::Null, Value::from))
        .collect();
    (listed, coarser)
}

/// Cell file number `rank`, the nodes `file` of `cell` whose HLOD 0 cell is `h` (`HlodNode`),
/// written as `scene-cell-<rank>.json`: its record — its address, its box in the frame of each
/// core parent its nodes hang under, how many nodes of each mesh it places, its grid cell and the
/// bounds that cell streams by, the main grid it lies on when that is not the first, its HLOD 0
/// cell — and the bounds the index pages it by, the cell's grown by its HLOD 0 cell's. Its
/// coordinates are on the ground when its grid lies flat.
fn cell_file(
    rank: usize,
    (cell, h, file): (&GridCell, Option<usize>, &[Placed]),
    (hlod, grids): (&[HlodNode], &Grids),
    directory: &Path,
) -> Result<(Value, Box6)> {
    let (level, [x, y, z]) = cell.coord;
    let grid = if grids.main(cell.grid).grid.flat() {
        json!([level, x, z])
    } else {
        json!([level, x, y, z])
    };
    let mut reach = cell.bounds;
    if let Some(h) = h {
        grow_flat(&mut reach, &hlod[h].shown);
    }
    let mut parents = BTreeMap::<Option<usize>, Box6>::new();
    for placed in file {
        grow_flat(
            parents.entry(placed.parent).or_insert(EMPTY_FLAT),
            &placed.local,
        );
    }
    let mut counts = BTreeMap::<u64, usize>::new();
    for mesh in file.iter().filter_map(|p| p.entry["mesh"].as_u64()) {
        *counts.entry(mesh).or_default() += 1;
    }
    let parents: Vec<Value> = parents.iter().map(|(p, b)| json!([p, b])).collect();
    let body = json!({"version": CELL_VERSION, "nodes": file.iter().map(|p| &p.entry).collect::<Vec<_>>()});
    let written = product(
        directory,
        &format!("scene-cell-{rank}.json"),
        &serde_json::to_vec(&body)?,
    )?;
    let leaf = h.map(|h| json!([h, hlod[h].shown, hlod[h].grid, hlod[h].rung]));
    let mut record = json!({"url": written.name, "sha256": written.sha256, "bytes": written.bytes,
        "parents": parents, "meshes": counts.into_iter().collect::<Vec<_>>(),
        "grid": grid, "bounds": cell.bounds, "hlod": leaf});
    if cell.grid > 0 {
        record["main"] = json!(cell.grid);
    }
    Ok((record, reach))
}
