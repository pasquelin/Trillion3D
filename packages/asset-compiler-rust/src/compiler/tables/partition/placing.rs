//! The scene's nodes as `gather` reads them (`candidates.rs`): which are objects, which an instanced
//! skinned object stays a plain one, and where the cell of each draws it — the row it takes
//! (`Row`), its world box, its box in the frame of the core node its row hangs under, and whether it
//! may take an HLOD layer.
use super::boxes::{carried, mesh_boxes, morphing};
use super::candidates::Row;
use super::scene::{named, still_nodes};
use super::*;
use crate::compiler::source::node_transform::{local_matrix, Mat4};
use crate::compiler::tables::motion::{
    bank::{animated_bounds, Banked},
    moved,
};
use crate::physics_cook::{declared_motion, declared_soft};
use trillion3d_math::geometry::box_transform::box_transform;
use trillion3d_math::matrix::IDENTITY;

/// The nodes of the input scene `source` the cooked physics moves or bends — each soft body it
/// declares (`declared_soft`) and each moving rigid body (`declared_motion`) —, and those it moves,
/// the rigid ones: what moves an object, as a clip does, and keeps it and its subtree out of HLOD.
fn simulated(source: &Value) -> (BTreeSet<usize>, BTreeSet<usize>) {
    let nodes = source["nodes"].as_array().map_or(&[][..], Vec::as_slice);
    let moving: BTreeSet<usize> = (0..nodes.len())
        .filter(|&id| declared_motion(&nodes[id]))
        .collect();
    let soft = (0..nodes.len()).filter(|&id| declared_soft(&nodes[id]).is_some());
    (soft.chain(moving.iter().copied()).collect(), moving)
}

/// A candidate placed: its row, its world box, its local box, and whether it may take an HLOD layer.
pub(super) struct Placed {
    pub row: Row,
    pub world: Box6,
    pub local: Box6,
    pub still: bool,
}

/// The input scene a plain skinned object's bounds are sampled from (`animated_bounds`): the
/// document, its binary and its meshes' boxes, and its hierarchy, read by the first object that
/// needs it.
struct Source<'a> {
    document: (&'a Value, &'a [u8], &'a [Option<Box6>]),
    parents: Option<Vec<Option<usize>>>,
}

/// What `gather` reads of the nodes: the published `table` and `worlds`, which of them the scene
/// `reached` and a hidden node hides, which a clip moves or a skin names, which the cooked physics
/// moves or bends (`simulated`), which meshes morph, each
/// mesh's box, whether each node keeps its declared pose and every node above it does — a box
/// written from those poses stays where it is, and an HLOD built of it stands where the object
/// does —, and the input scene.
pub(super) struct Placing<'a> {
    pub table: &'a [Value],
    worlds: &'a [Mat4],
    nodes: &'a [Value],
    reached: &'a [bool],
    hidden: BTreeSet<usize>,
    moved: BTreeSet<usize>,
    simulated: BTreeSet<usize>,
    named: BTreeSet<usize>,
    morphs: Vec<bool>,
    boxes: Vec<Option<Box6>>,
    still: Vec<bool>,
    source: Source<'a>,
}

/// The box `bounds` carried by `matrix`.
fn boxed(bounds: &Box6, matrix: &Mat4) -> Box6 {
    let mut out = EMPTY_FLAT;
    box_transform(&mut out, bounds, matrix);
    out
}

impl<'a> Placing<'a> {
    /// The nodes of `table` — those of the document `g` published —, their `worlds`, `parent`s and
    /// whether the scene `reached` each, over the input scene `source` (the document, its binary and
    /// its meshes' boxes).
    pub(super) fn of(
        g: &'a Value,
        (table, worlds): (&'a [Value], &'a [Mat4]),
        (parent, reached): (&[Option<usize>], &'a [bool]),
        source: (&'a Value, &'a [u8], &'a [Option<Box6>]),
    ) -> Result<Self> {
        // A cell's row says no visibility: a node a hidden node hides is read with the core.
        let (_, hidden) = crate::compiler::source::nodes::scene_nodes(g)?;
        let moved = moved(g);
        let (simulated, moving) = simulated(source.0);
        Ok(Self {
            table,
            worlds,
            nodes: values(g, "nodes")?,
            reached,
            hidden,
            still: still_nodes(parent, &moved.union(&moving).copied().collect()),
            moved,
            simulated,
            named: named(g),
            morphs: morphing(g),
            boxes: mesh_boxes(g),
            source: Source {
                document: source,
                parents: None,
            },
        })
    }

    /// Whether node `id` is shown: the scene reaches it and no hidden node hides it.
    fn shown(&self, id: usize) -> bool {
        self.reached[id] && !self.hidden.contains(&id)
    }

    /// Whether node `id` is an object: it draws a mesh, is shown and carries no camera. A camera
    /// holds its node in the core; a lamp does not: `lights.json` places it, in world space.
    pub(super) fn object(&self, id: usize) -> bool {
        let node = &self.table[id];
        node["mesh"].is_u64() && self.shown(id) && node["camera"].is_null()
    }

    /// The mesh object `id` draws.
    pub(super) fn mesh_of(&self, id: usize) -> usize {
        self.table[id]["mesh"].as_u64().expect("an object's mesh") as usize
    }

    /// Why an object its settings make an instanced skinned one stays a plain skinned one: a skin or
    /// a clip names its node by its core rank, or the frame it would hang under would hide it.
    pub(super) fn unbankable(&self, id: usize, frame: Option<usize>) -> Option<&'static str> {
        if self.named.contains(&id) {
            Some("a skin names its node as a joint")
        } else if self.moved.contains(&id) {
            Some("a clip moves its node")
        } else if frame.is_some_and(|f| !self.shown(f)) {
            Some("its skin's frame is hidden or outside the scene")
        } else {
            None
        }
    }

    /// A skin frame's world, the scene root's when the skin has none.
    fn world_of(&self, frame: Option<usize>) -> Mat4 {
        frame.map_or(IDENTITY, |f| self.worlds[f])
    }

    /// The world box and the local box of animated object `id`, drawn from its own node: a skinned
    /// one bounded by its clips' bounds at its skin frame's world, carried into its node's frame —
    /// where its palette draws it —, any other by its mesh's box `mesh_box`, morph targets' offsets
    /// included. None when no box bounds it.
    fn animated_boxes(
        &mut self,
        id: usize,
        mesh_box: Option<Box6>,
    ) -> Result<Option<(Box6, Box6)>> {
        if self.table[id]["skin"].is_null() {
            return Ok(mesh_box.map(|bounds| (boxed(&bounds, &self.worlds[id]), bounds)));
        }
        let (g, bin, boxes) = self.source.document;
        let parents = &mut self.source.parents;
        let Some((frame, bounds)) = animated_bounds(g, bin, id, (boxes, parents))? else {
            return Ok(None);
        };
        let from = self.world_of(frame);
        let local = carried(&bounds, &from, &self.worlds[id]);
        Ok(local.map(|local| (boxed(&bounds, &from), local)))
    }

    /// Where object `id`, whose place among the instanced skinned objects is `bank`, is drawn by its
    /// cell, none when no box places it.
    pub(super) fn place(&mut self, id: usize, bank: Option<&Banked>) -> Result<Option<Placed>> {
        let (table, mesh) = (self.table, self.mesh_of(id));
        let node = &table[id];
        let mesh_box = self.boxes.get(mesh).copied().flatten();
        let animated = !node["skin"].is_null()
            || self.morphs.get(mesh) == Some(&true)
            || !node["weights"].is_null()
            || self.moved.contains(&id)
            || self.simulated.contains(&id)
            || self.named.contains(&id);
        let leaf = node["children"].as_array().is_some_and(Vec::is_empty);
        let placed = |row, (world, local), still| {
            Some(Placed {
                row,
                world,
                local,
                still,
            })
        };
        Ok(match bank {
            // At its skin's frame, bounded by its item's sampled bounds; an HLOD layer only when
            // its mobility keeps it still and nothing moves its frame (`Banked::hlod`).
            Some(banked) => {
                let boxes = (
                    boxed(&banked.bounds, &self.world_of(banked.frame)),
                    banked.bounds,
                );
                let track = Row::Track {
                    item: banked.item,
                    frame: banked.frame,
                };
                placed(track, boxes, banked.hlod)
            }
            // Drawn from its own node, never in an HLOD layer.
            None if animated => {
                let boxes = self.animated_boxes(id, mesh_box)?;
                boxes.and_then(|boxes| placed(Row::Source, boxes, false))
            }
            // At its declared pose under its nearest core node, which may move: then no layer.
            None if leaf => match mesh_box {
                Some(bounds) => {
                    let local = boxed(&bounds, &local_matrix(&self.nodes[id])?);
                    let boxes = (boxed(&bounds, &self.worlds[id]), local);
                    placed(Row::Posed, boxes, self.still[id])
                }
                None => None,
            },
            // Under its own node, kept in the core for the nodes under it.
            None => mesh_box.and_then(|bounds| {
                let boxes = (boxed(&bounds, &self.worlds[id]), bounds);
                placed(Row::Own, boxes, self.still[id])
            }),
        })
    }
}
