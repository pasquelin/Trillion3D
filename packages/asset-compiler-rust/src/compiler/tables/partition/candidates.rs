//! The nodes that may stream (`Candidate`) and the batches they stream in. An object — a node
//! drawing a mesh, shown, carrying no camera — is spatially loaded unless its settings say
//! otherwise (`ObjectSettings`, `spatiallyLoaded`). How its cell draws it depends on what moves it
//! and what hangs under it (`Row`):
//!
//! - a static leaf — no skin, no morph target nor weights, no clip moving it, no skin naming it —
//!   leaves the table the runtime reads before its first frame: its cell places its mesh at its
//!   declared pose under its nearest core node, even one an animation moves — its row follows it;
//! - a static object with nodes under it stays in the core for them, its mesh off its node: its
//!   cell places that mesh at no pose under its own core node, and its mesh enters its layer's
//!   HLOD as a leaf's does;
//! - an instanced skinned object (`motion/bank.rs`, `Banked`) leaves the table: its cell places its
//!   mesh at no pose under its skin's frame, playing its item of the scene's animation banks;
//! - an animated object — skinned, morphed, moved by a clip, or a skin's joint — stays in the
//!   core, where its clips, its skin and the page's own code name it by rank: its node says it
//!   streams (`"streamed"`), and its cell draws a row of its mesh under that node at no pose, the
//!   node's own host mesh that row's animation source.
//!
//! Objects attached under one another stream together, as the reference keeps an actor with the
//! actors attached under it: the topmost object above a node and every object under it make one
//! batch, placed in one cell by the box around their world boxes (`Gathered::batches`); a batch
//! one object of which is not spatially loaded is always loaded whole, in the core. A node drawing
//! no mesh is a frame objects hang from, not an object: it joins no batch.
use super::boxes::{carried, grown, mesh_boxes, morphing};
use super::scene::{batch_roots, named, still_nodes};
use super::*;
use crate::compiler::source::node_transform::local_matrix;
use crate::compiler::tables::motion::{bank::animated_bounds, moved};
use trillion3d_math::geometry::box_transform::box_transform;
use trillion3d_math::matrix::IDENTITY;

/// How a cell draws a node it holds: its mesh at the node's declared pose under its nearest core
/// node (`Posed`); its mesh at no pose under its own core node, which the core keeps for the nodes
/// under it without its mesh (`Own`); an instanced skinned object's mesh at no pose under its
/// skin's frame, playing an item of the scene's animation banks (`Track`); or the mesh of an
/// animated object the core keeps, at no pose under that object's own node, whose host mesh is
/// its animation source (`Source`).
#[derive(Clone, Copy)]
pub(super) enum Row {
    Posed,
    Own,
    Track { item: usize, frame: Option<usize> },
    Source,
}

impl Row {
    /// Whether the core keeps the node a cell draws so: for the nodes under it, or as the
    /// animation source of its row.
    pub(super) fn kept(self) -> bool {
        matches!(self, Row::Own | Row::Source)
    }
}

/// A node that may stream: its rank, its mesh, how its cell draws it (`Row`), its world box, its
/// box in the frame of the core node its row hangs under, whether it may take an HLOD layer —
/// nothing moves it, itself or through a node above it, and an instanced skinned object's mobility
/// keeps it still —, and the root of its batch.
pub(super) struct Candidate {
    pub node: usize,
    pub mesh: usize,
    pub row: Row,
    pub world: Box6,
    pub local: Box6,
    pub still: bool,
    pub batch: usize,
}

impl Candidate {
    /// The core node its row hangs under — `parent` giving each node's parent in `table`, `rank`
    /// each node's rank in the core —, and the row its cell writes: a pose only where the node
    /// declares one.
    pub(super) fn entry(
        &self,
        table: &[Value],
        parent: &[Option<usize>],
        rank: &[Option<usize>],
    ) -> (Option<usize>, Value) {
        let (id, mesh) = (self.node, self.mesh);
        match self.row {
            Row::Posed => {
                let (node, core_parent) = (&table[id], parent[id].and_then(|p| rank[p]));
                let entry = json!({
                    "parent": core_parent,
                    "mesh": mesh,
                    "matrix": node["matrix"], "translation": node["translation"],
                    "rotation": node["rotation"], "scale": node["scale"],
                });
                (core_parent, entry)
            }
            Row::Own => (rank[id], json!({"parent": rank[id], "mesh": mesh})),
            Row::Track { item, frame } => {
                let core_parent = frame.and_then(|f| rank[f]);
                let entry = json!({"parent": core_parent, "mesh": mesh, "track": item});
                (core_parent, entry)
            }
            Row::Source => (
                rank[id],
                json!({"parent": rank[id], "mesh": mesh, "source": true}),
            ),
        }
    }
}

/// What `gather` finds: the candidates, of batches every object of which is spatially loaded; the
/// box around each batch's candidates' world boxes, by its root; every instanced skinned object —
/// its node, its item, its skin's frame —; and why each object its settings make an instanced
/// skinned one stays a plain skinned one (`Banks::refused`, then the partition's).
pub(super) struct Gathered {
    pub candidates: Vec<Candidate>,
    pub batches: BTreeMap<usize, Box6>,
    pub bankable: Vec<(usize, usize, Option<usize>)>,
    pub bank_warnings: Vec<(usize, String)>,
}

/// The candidates of `table` (`Gathered`), its nodes' `parent`s and whether the scene reaches each
/// (`reached`) given: none with the streaming off (`PartitionGrid::streams`). `objects` says which
/// objects are spatially loaded; `banks`, the instanced skinned objects and the items they play;
/// `source`, its binary and its meshes' boxes, the input scene a plain skinned object's bounds are
/// sampled from (`animated_bounds`).
pub(super) fn gather(
    (g, worlds): (&Value, &[Mat4]),
    (grid, objects, banks): (&crate::PartitionGrid, &crate::ObjectSettings, &Banks),
    (source, bin, source_boxes): (&Value, &[u8], &[Option<Box6>]),
    table: &[Value],
    (parent, reached): (&[Option<usize>], &[bool]),
) -> Result<Gathered> {
    let gltf_nodes = values(g, "nodes")?;
    let (boxes, morphs) = (mesh_boxes(g), morphing(g));
    let (moved, named) = (moved(g), named(g));
    // A cell's row says no visibility: a node a hidden node hides is read with the core.
    let (_, hidden) = crate::compiler::source::nodes::scene_nodes(g)?;
    let shown = |id: usize| reached[id] && !hidden.contains(&id);
    // A camera holds its node in the core; a lamp does not: `lights.json` places it, in world
    // space.
    let object =
        |id: usize| table[id]["mesh"].is_u64() && shown(id) && table[id]["camera"].is_null();
    // Whether a node keeps its declared pose, and every node above it does: a box written from
    // those poses stays where it is, and an HLOD built of it stands where the object does.
    let still_of = still_nodes(parent, &moved);
    let still = |id: usize| still_of[id];
    // A skin frame's world, the scene root's when the skin has none.
    let world_of = |frame: Option<usize>| frame.map_or(IDENTITY, |f| worlds[f]);
    let boxed = |bounds: &Box6, matrix: &Mat4| {
        let mut out = EMPTY_FLAT;
        box_transform(&mut out, bounds, matrix);
        out
    };
    // Why an object its settings make an instanced skinned one stays a plain skinned one: a skin
    // or a clip names its node by its core rank, or the frame it would hang under would hide it.
    let unbankable = |id: usize, frame: Option<usize>| {
        if named.contains(&id) {
            Some("a skin names its node as a joint")
        } else if moved.contains(&id) {
            Some("a clip moves its node")
        } else if frame.is_some_and(|f| !shown(f)) {
            Some("its skin's frame is hidden or outside the scene")
        } else {
            None
        }
    };
    let roots = batch_roots(parent, &object);
    let mut bank_warnings = banks.refused.clone();
    // The input scene's hierarchy, read by the first plain skinned object that needs it.
    let mut source_parents = None;
    let (mut bankable, mut candidates, mut pinned) = (Vec::new(), Vec::new(), BTreeSet::new());
    for id in (0..table.len()).filter(|&id| object(id)) {
        let node = &table[id];
        let mesh = node["mesh"].as_u64().expect("an object's mesh") as usize;
        let mut bank = banks.objects.get(&id);
        if let Some(why) = bank.and_then(|banked| unbankable(id, banked.frame)) {
            bank_warnings.push((id, why.to_string()));
            bank = None;
        }
        bankable.extend(bank.map(|banked| (id, banked.item, banked.frame)));
        if !grid.streams {
            continue;
        }
        let batch = roots[id].expect("an object is its batch's or under its root");
        if !objects.node(g, id)?.spatially_loaded {
            pinned.insert(batch);
            continue;
        }
        let mesh_box = boxes.get(mesh).copied().flatten();
        let animated = !node["skin"].is_null()
            || morphs.get(mesh) == Some(&true)
            || !node["weights"].is_null()
            || moved.contains(&id)
            || named.contains(&id);
        let leaf = node["children"].as_array().is_some_and(Vec::is_empty);
        let (row, world, local, still) = match bank {
            // At its skin's frame, bounded by its item's sampled bounds; an HLOD layer only when
            // its mobility keeps it still and nothing moves its frame (`Banked::hlod`).
            Some(banked) => (
                Row::Track {
                    item: banked.item,
                    frame: banked.frame,
                },
                boxed(&banked.bounds, &world_of(banked.frame)),
                banked.bounds,
                banked.hlod,
            ),
            // Drawn from its own node: a skinned one bounded by its clips' bounds at its skin
            // frame's world, carried into its node's frame — where its palette draws it —, any
            // other by its mesh's box, morph targets' offsets included. Never an HLOD layer.
            None if animated => {
                let (world, local) = if node["skin"].is_null() {
                    let Some(mesh_box) = mesh_box else { continue };
                    (boxed(&mesh_box, &worlds[id]), mesh_box)
                } else {
                    let swept =
                        animated_bounds(source, bin, id, (source_boxes, &mut source_parents))?;
                    let Some((frame, bounds)) = swept else {
                        continue;
                    };
                    let from = world_of(frame);
                    let Some(local) = carried(&bounds, &from, &worlds[id]) else {
                        continue;
                    };
                    (boxed(&bounds, &from), local)
                };
                (Row::Source, world, local, false)
            }
            // At its declared pose under its nearest core node, which may move: then no layer.
            None if leaf => {
                let Some(mesh_box) = mesh_box else { continue };
                let local = boxed(&mesh_box, &local_matrix(&gltf_nodes[id])?);
                (Row::Posed, boxed(&mesh_box, &worlds[id]), local, still(id))
            }
            // Under its own node, kept in the core for the nodes under it.
            None => {
                let Some(mesh_box) = mesh_box else { continue };
                (Row::Own, boxed(&mesh_box, &worlds[id]), mesh_box, still(id))
            }
        };
        candidates.push(Candidate {
            node: id,
            mesh,
            row,
            world,
            local,
            still,
            batch,
        });
    }
    candidates.retain(|c| !pinned.contains(&c.batch));
    let mut batches = BTreeMap::new();
    for c in &candidates {
        grown(&mut batches, c.batch, &c.world);
    }
    Ok(Gathered {
        candidates,
        batches,
        bankable,
        bank_warnings,
    })
}
