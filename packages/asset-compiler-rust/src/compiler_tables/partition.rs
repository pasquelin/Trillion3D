//! The world partition of the node table (#404): a node that only places a mesh — a leaf of the
//! scene, carrying no light, no camera, no skin, no morph weights, that no animation moves, nor any
//! of its ancestors — leaves the table the runtime reads before its first frame and is written in
//! a spatial cell instead, which the runtime reads by distance to its camera. What stays is the core: every other
//! node, the ranks renumbered without the placed ones.
//!
//! A cell is halved along its widest axis until its bytes fit one stream unit
//! (`STREAM_BUNDLE_BYTES`), the budget a geometry bundle has. It carries, for each core parent its
//! nodes hang under, the box around them in that parent's frame: a page that moves the parent
//! moves the box, and the runtime reads the cell where its objects are. A scene whose placed nodes
//! fit one unit is not partitioned: its table is the one it was. The cells' records are paged
//! (`pages.rs`): the core keeps a root of fixed size.
use super::*;
use crate::compiler_world::{local_matrix, world_matrices, Mat4};

mod boxes;
pub(crate) mod pages;
mod scene;
pub(crate) mod split;
use boxes::{grow, mesh_boxes, world_box, EMPTY};
use pages::{write_pages, MeshSlots};
use scene::{animated, hierarchy};
use split::{split_cells, Placed, Region};

/// A box, `[minX, minY, minZ, maxX, maxY, maxZ]`.
type Box6 = [f64; 6];

/// Version of a page and of the root the core carries.
const PARTITION_VERSION: u32 = 4;
/// Version of a cell file.
const CELL_VERSION: u32 = 2;

/// The core the runtime reads first, the root of the cells it reads by distance, and their count.
pub(super) struct Partitioned {
    pub nodes: Vec<Value>,
    pub roots: Vec<usize>,
    pub partition: Value,
    pub cells: usize,
    /// Each node's rank in the core, `None` for a placed one.
    pub rank: Vec<Option<usize>>,
}

/// The core and the cells of `table`, or `None` when its placed nodes fit one cell, and the
/// published nodes each cell places: then one cell places them all (`compiler_world_roots`).
pub(super) fn partition(
    g: &Value,
    table: &[Value],
    roots: &[usize],
    mesh_pages: &MeshSlots,
    directory: &Path,
) -> Result<(Option<Partitioned>, Vec<Vec<usize>>)> {
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
        let bare = ["light", "camera", "weights"]
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
    let worlds = world_matrices(g)?;
    let mut placed = Vec::with_capacity(placed_ids.len());
    for (id, mesh) in placed_ids {
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
        placed.push(Placed {
            node: id,
            bounds: world_box(&worlds[id], mesh_box),
            parent: core_parent,
            local: world_box(&local_matrix(&gltf_nodes[id])?, mesh_box),
            entry,
            bytes,
        });
    }
    if placed.iter().map(|p| p.bytes).sum::<usize>() <= crate::STREAM_BUNDLE_BYTES {
        return Ok((None, vec![placed.iter().map(|p| p.node).collect()]));
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
    let (cells, tree) = split_cells(placed);
    let members = cells
        .iter()
        .map(|c| c.iter().map(|p| p.node).collect())
        .collect();
    let split = Some(Partitioned {
        nodes,
        roots,
        cells: cells.len(),
        partition: write_cells(cells, &tree, mesh_pages, directory)?,
        rank,
    });
    Ok((split, members))
}

/// Writes one file per cell and the pages of their records, and returns the root the core
/// carries, its region pages naming the `mesh_pages` their cells use. A record is the cell's
/// address, fingerprint, size, its box in the frame of each core parent it hangs nodes under, and
/// how many nodes of each mesh it places — what the runtime sizes its rows by before its first
/// frame.
fn write_cells(
    cells: Vec<Vec<Placed>>,
    tree: &Region,
    mesh_pages: &MeshSlots,
    directory: &Path,
) -> Result<Value> {
    let mut records = Vec::with_capacity(cells.len());
    let mut bounds = Vec::with_capacity(cells.len());
    for (at, cell) in cells.iter().enumerate() {
        let mut parents = BTreeMap::<Option<usize>, Box6>::new();
        let mut union = EMPTY;
        for placed in cell {
            grow(parents.entry(placed.parent).or_insert(EMPTY), &placed.local);
            grow(&mut union, &placed.bounds);
        }
        let mut counts = BTreeMap::<u64, usize>::new();
        for mesh in cell.iter().filter_map(|p| p.entry["mesh"].as_u64()) {
            *counts.entry(mesh).or_default() += 1;
        }
        let parents: Vec<Value> = parents.iter().map(|(p, b)| json!([p, b])).collect();
        let body = json!({"version": CELL_VERSION, "nodes": cell.iter().map(|p| &p.entry).collect::<Vec<_>>()});
        let written = product(
            directory,
            &format!("scene-cell-{at}.json"),
            &serde_json::to_vec(&body)?,
        )?;
        records.push(json!({"url": written.name, "sha256": written.sha256, "bytes": written.bytes, "parents": parents, "meshes": counts.into_iter().collect::<Vec<_>>()}));
        bounds.push(union);
    }
    write_pages(tree, &records, &bounds, mesh_pages, directory)
}
