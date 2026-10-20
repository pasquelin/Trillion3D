//! The world partition of the node table: a node that only places a mesh — a leaf of the
//! scene, carrying no light, no camera, no skin, no morph weights, that no animation moves, nor any
//! of its ancestors — leaves the table the runtime reads before its first frame and is written in
//! a spatial cell instead, which the runtime streams by distance to its camera. What stays is the
//! core — every other node, the ranks renumbered without the placed ones —: the nodes that are not
//! spatially loaded, always there.
//!
//! The cells are those of a loose hierarchical grid (`grid.rs`): every placed node in the main
//! grid's cell its world box goes to (`split.rs`), each cell's HLOD 0 cell and the chain of HLOD
//! cells above it, one per layer, each on a grid twice as coarse (`hlod.rs`). A cell carries, for
//! each core parent its nodes hang under, the box around them in that parent's frame, and the world
//! bounds each grid streams it by — its own, its HLOD 0 cell's, its HLOD 1 cell's —, which the
//! runtime tests against those grids' loading ranges, written in the root; the chain itself is the
//! world HLOD's table's (`compiler_world_roots`). A scene with no placed node is not partitioned:
//! its table is the one it was, all of it always there. The cells' records are paged (`pages.rs`):
//! the core keeps a root of fixed size.
use super::*;
use crate::compiler_world::{local_matrix, Mat4};

mod boxes;
pub(crate) mod grid;
mod hlod;
pub(crate) mod pages;
mod scene;
pub(crate) mod split;
use boxes::mesh_boxes;
use hlod::hlod_cells;
pub(crate) use hlod::HlodNode;
use pages::{write_pages, MeshSlots};
use scene::{animated, hierarchy};
use split::{grid_cells, GridCell, Placed, Region};
use trillion3d_math::aabb::{grow_flat, EMPTY_FLAT};
use trillion3d_math::box_transform::box_transform;

/// A box, `[minX, minY, minZ, maxX, maxY, maxZ]`.
type Box6 = [f64; 6];

/// Version of a page and of the root the core carries: 5 since a lamp's node may stand in a cell,
/// 6 since the cells are the loose grid's cells, each naming its HLOD cells' bounds and the
/// root the grids' loading ranges.
const PARTITION_VERSION: u32 = 6;
/// Version of a cell file.
const CELL_VERSION: u32 = 2;

/// The published nodes each cell places, by cell rank; each cell's HLOD 0 cell, and the whole
/// chain of HLOD cells, those first (`hlod.rs`): what the world's HLOD layers are built over
/// (`compiler_world_roots`). With them, the compile's warnings: each placed node whose mark won
/// over a rule naming another layer — its node, the mark's layer and the rule's (`Assigned`) —,
/// and each node marked but not placed — animated, a parent, hidden —, which no HLOD takes.
#[derive(Default)]
pub(crate) struct CellMembers {
    pub nodes: Vec<Vec<usize>>,
    pub hlod: Vec<usize>,
    pub tree: Vec<HlodNode>,
    pub overruled: Vec<(usize, usize, usize)>,
    pub unplaced: Vec<usize>,
}

/// The core the runtime reads first, the root of the cells it reads by distance, and their count.
pub(super) struct Partitioned {
    pub nodes: Vec<Value>,
    pub roots: Vec<usize>,
    pub partition: Value,
    pub cells: usize,
    /// Each node's rank in the core, `None` for a placed one.
    pub rank: Vec<Option<usize>>,
}

/// The core and the cells of `table`, or `None` when it places no node, and the published nodes
/// each cell places with their HLOD cells (`CellMembers`), each node in the cells of the HLOD
/// layer `hlod` assigns it — once, here, for every stage after (`Hlod::assigned`). An HLOD that
/// assigns no placed node a layer refuses the job.
pub(super) fn partition(
    (g, worlds): (&Value, &[Mat4]),
    hlod: &crate::Hlod,
    table: &[Value],
    roots: &[usize],
    mesh_pages: &MeshSlots,
    directory: &Path,
) -> Result<(Option<Partitioned>, CellMembers)> {
    let gltf_nodes = values(g, "nodes")?;
    let boxes = mesh_boxes(g);
    let moved = animated(g);
    let (parent, reached) = hierarchy(table, roots);
    // A cell's row says no visibility: a node a hidden node hides is read with the core.
    let (_, hidden) = crate::compiler_nodes::scene_nodes(g)?;
    let placeable = |id: usize| -> Option<usize> {
        let node = &table[id];
        let mesh = node["mesh"].as_u64()? as usize;
        let leaf = node["children"].as_array().is_some_and(Vec::is_empty);
        // A lamp does not hold its node in the core: `lights.json` places it, in world space.
        let bare = ["camera", "weights"]
            .iter()
            .all(|field| node[*field].is_null());
        // Its box is written once, from the declared poses: nothing above it may move either.
        let posed =
            std::iter::successors(Some(id), |at| parent[*at]).all(|at| !moved.contains(&at));
        let still = gltf_nodes[id].get("skin").is_none() && posed && !hidden.contains(&id);
        (reached[id] && leaf && bare && still && boxes.get(mesh)?.is_some()).then_some(mesh)
    };
    let placed_ids: Vec<(usize, usize)> = (0..table.len())
        .filter_map(|id| placeable(id).map(|mesh| (id, mesh)))
        .collect();
    // The core keeps every other node, renumbered in order.
    let mut rank = vec![None; table.len()];
    let placed_set: BTreeSet<usize> = placed_ids.iter().map(|(id, _)| *id).collect();
    let mut kept = 0usize;
    for (id, slot) in rank.iter_mut().enumerate() {
        if !placed_set.contains(&id) {
            *slot = Some(kept);
            kept += 1;
        }
    }
    // Every mark is read, a placed node's or not: one naming no group nor layer refuses the job.
    let mut unplaced = Vec::new();
    for id in (0..table.len()).filter(|id| !placed_set.contains(id)) {
        if crate::compiler_args::marked(g, id) {
            hlod.assigned(g, id)?;
            unplaced.push(id);
        }
    }
    let mut placed = Vec::with_capacity(placed_ids.len());
    let mut overruled = Vec::new();
    for (id, mesh) in placed_ids {
        let assigned = hlod.assigned(g, id)?;
        if let (Some(layer), Some(ruled)) = (assigned.layer, assigned.overruled) {
            overruled.push((id, layer, ruled));
        }
        let node = &table[id];
        let core_parent = parent[id].and_then(|p| rank[p]);
        let entry = json!({
            "parent": core_parent,
            "mesh": mesh,
            "matrix": node["matrix"], "translation": node["translation"],
            "rotation": node["rotation"], "scale": node["scale"],
        });
        let mesh_box = boxes[mesh].as_ref().expect("placeable");
        let bytes = serde_json::to_vec(&entry)?.len() + 1;
        // The mesh's box in the world and in its parent's frame.
        let (mut bounds, mut local) = (EMPTY_FLAT, EMPTY_FLAT);
        box_transform(&mut bounds, mesh_box, &worlds[id]);
        box_transform(&mut local, mesh_box, &local_matrix(&gltf_nodes[id])?);
        placed.push(Placed {
            node: id,
            layer: assigned.layer,
            bounds,
            parent: core_parent,
            local,
            entry,
            bytes,
        });
    }
    if !hlod.layers.is_empty() && !placed.is_empty() && placed.iter().all(|p| p.layer.is_none()) {
        return Err(crate::compiler_validate::OPTIONS.bad(format!(
            "{HLOD_FIELD} assigns no placed object a layer: mark objects (extras.{HLOD_MARK}) or \
             name them by groups or rules"
        )));
    }
    if placed.is_empty() {
        return Ok((None, CellMembers::default()));
    }
    let renumber = |ids: &[Value]| -> Vec<usize> {
        ids.iter()
            .filter_map(|v| rank[v.as_u64()? as usize])
            .collect()
    };
    let nodes = table
        .iter()
        .enumerate()
        .filter(|(id, _)| rank[*id].is_some())
        .map(|(_, node)| {
            let mut node = node.clone();
            node["children"] = json!(renumber(
                node["children"].as_array().map_or(&[][..], Vec::as_slice)
            ));
            node
        })
        .collect();
    let roots = roots.iter().filter_map(|id| rank[*id]).collect();
    let (cells, tree_of) = grid_cells(placed);
    let (hlod_of, tree) = hlod_cells(&cells, hlod);
    let mut members = CellMembers::default();
    for (cell, &h) in cells.iter().zip(&hlod_of) {
        for file in &cell.files {
            members.nodes.push(file.iter().map(|p| p.node).collect());
            members.hlod.push(h);
        }
    }
    let split = Some(Partitioned {
        nodes,
        roots,
        cells: members.nodes.len(),
        partition: write_cells((&cells, &tree_of), (&hlod_of, &tree), mesh_pages, directory)?,
        rank,
    });
    members.tree = tree;
    members.overruled = overruled;
    members.unplaced = unplaced;
    Ok((split, members))
}

/// Writes one file per cell file and the pages of their records, and returns the root the core
/// carries, its region pages naming the `mesh_pages` their cells use, and the grids' loading
/// ranges (`grid.rs`). A record is the file's address, fingerprint, size, its box in the frame of
/// each core parent it hangs nodes under, how many nodes of each mesh it places — what the runtime
/// sizes its rows by before its first frame —, its grid cell, the world bounds that cell streams by,
/// its HLOD 0 cell's and that of the HLOD 1 cell its HLOD 1 actor lies in (`HlodNode`) — its own
/// for a top cell —, the bounds the index pages it by holding all three. The root adds every HLOD
/// grid's loading range and the HLOD 0 cells' count.
fn write_cells(
    (cells, tree): (&[GridCell], &Region),
    (hlod_of, hlod): (&[usize], &[HlodNode]),
    mesh_pages: &MeshSlots,
    directory: &Path,
) -> Result<Value> {
    let mut records = Vec::new();
    let mut bounds = Vec::new();
    for (cell, &h) in cells.iter().zip(hlod_of) {
        let (level, [x, z]) = cell.coord;
        let shown = &hlod[h].shown;
        let loaded = &hlod[h].parent.map_or(*shown, |parent| hlod[parent].shown);
        let mut reach = cell.content;
        grow_flat(&mut reach, shown);
        grow_flat(&mut reach, loaded);
        for file in &cell.files {
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
                &format!("scene-cell-{}.json", records.len()),
                &serde_json::to_vec(&body)?,
            )?;
            records.push(json!({"url": written.name, "sha256": written.sha256, "bytes": written.bytes, "parents": parents, "meshes": counts.into_iter().collect::<Vec<_>>(),
                "grid": [level, x, z], "bounds": cell.content, "hlod": [h, shown, loaded]}));
            bounds.push(reach);
        }
    }
    let mut root = write_pages(tree, &records, &bounds, mesh_pages, directory)?;
    // Fixed width, as every other list of the root: the bits of each range as an `f64` in sixteen
    // hexadecimal digits, the HLOD 0 cells' count in eight. Every layer that has a grid: the top
    // layer's actors are always loaded (`hlod.rs`).
    let layers = hlod.iter().map(|node| node.level).max().unwrap_or(0) + 1;
    let leaves = hlod.iter().filter(|node| node.level == 0).count();
    let ranges: Vec<String> = std::iter::once(grid::MAIN_LOADING_RANGE)
        .chain((0..layers).map(|layer| grid::hlod_grid(layer).1))
        .map(|range| format!("{:016x}", range.to_bits()))
        .collect();
    root["hlod"] = json!({"ranges": ranges, "cells": format!("{:08x}", leaves)});
    Ok(root)
}
