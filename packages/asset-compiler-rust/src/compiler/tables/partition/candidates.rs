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
//! - an animated object — skinned, morphed, moved by a clip, a skin's joint, or moved or bent by
//!   the cooked physics (`Placing::simulated`) — stays in the core, where its clips, its skin, its
//!   body and the page's own code name it: its node says it streams (`"streamed"`), and its cell
//!   draws a row of its mesh under that node at no pose, the node's own host mesh that row's
//!   animation source. The runtime makes its body when that cell is placed and lets it go when the
//!   cell leaves: its render and its physics stream together, in its cell.
//!
//! Every row names the source node it draws (`"sourceNode"`, eight hexadecimal digits, as the core
//! does): what `physics.json` names a body or a collider by.
//!
//! Objects attached under one another stream together, as the reference keeps an actor with the
//! actors attached under it: the topmost object above a node and every object under it make one
//! batch, placed in one cell by the box around their world boxes (`Gathered::batches`); a batch
//! one object of which is not spatially loaded is always loaded whole, in the core. A node drawing
//! no mesh is a frame objects hang from, not an object: it joins no batch.
use super::boxes::grown;
use super::placing::Placing;
use super::scene::batch_roots;
use super::split::assign_grids;
use super::*;
use crate::compiler::args::objects::DrawDistance;

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
/// keeps it still —, the root of its batch, the main grid it streams on (`assign_grids`), and the
/// distances it is drawn at, when its settings name any (`DrawDistance`), whether a view's primed
/// depth draws it (`far_field`).
pub(super) struct Candidate {
    pub node: usize,
    pub mesh: usize,
    pub row: Row,
    pub world: Box6,
    pub local: Box6,
    pub still: bool,
    pub batch: usize,
    pub grid: usize,
    pub draw_distance: Option<DrawDistance>,
    pub far_field: bool,
}

impl Candidate {
    /// The core node its row hangs under — `parent` giving each node's parent in `table`, `rank`
    /// each node's rank in the core —, and the row its cell writes: the source node it draws, a pose
    /// only where the node declares one, the distances it is drawn at only where its settings name
    /// them, the parents of its part's roots only for an instance of an assembly (`rootParents`).
    pub(super) fn entry(
        &self,
        table: &[Value],
        parent: &[Option<usize>],
        rank: &[Option<usize>],
    ) -> (Option<usize>, Value) {
        let (id, mesh) = (self.node, self.mesh);
        let (core_parent, mut entry) = match self.row {
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
        };
        let source = u32::try_from(id).expect("a published node rank fits u32");
        entry["sourceNode"] = json!(format!("{source:08x}"));
        if let Some(distance) = &self.draw_distance {
            entry["drawDistance"] = distance.entry();
        }
        if self.far_field {
            entry["farField"] = json!(true);
        }
        // An instance of an assembly: what replaces the roots of its part's primitives.
        if let Some(roots) = table[id].get("rootParents") {
            entry["rootParents"] = roots.clone();
        }
        (core_parent, entry)
    }
}

/// What `gather` finds: the candidates, of batches every object of which is spatially loaded; the
/// box around each batch's candidates' world boxes, by its root; every instanced skinned object —
/// its node, its item, its skin's frame —; and why each object its settings make an instanced
/// skinned one stays a plain skinned one (`Banks::refused`, then the partition's); and each batch
/// root that names a streaming grid the job does not hold, with the name.
pub(super) struct Gathered {
    pub candidates: Vec<Candidate>,
    pub batches: BTreeMap<usize, Box6>,
    pub bankable: Vec<(usize, usize, Option<usize>)>,
    pub bank_warnings: Vec<(usize, String)>,
    pub unknown_grids: Vec<(usize, String)>,
}

/// What `gather` has found of the objects so far: the candidates, the instanced skinned objects
/// and the reasons the others stay plain, the batches an object not spatially loaded pins, and the
/// grid each batch root names.
#[derive(Default)]
struct Found {
    candidates: Vec<Candidate>,
    bankable: Vec<(usize, usize, Option<usize>)>,
    bank_warnings: Vec<(usize, String)>,
    pinned: BTreeSet<usize>,
    named_grids: BTreeMap<usize, String>,
}

impl Found {
    /// Object `id` of `scene` found, its batch rooted at `roots[id]`. `banks` say which objects are
    /// instanced skinned ones, `objects` which are spatially loaded and on which grid; `grid` is the
    /// job's: with the streaming off an object is none but a bank's.
    fn visit(
        &mut self,
        id: usize,
        (scene, roots): (&mut Placing<'_>, &[Option<usize>]),
        (g, grid, objects, banks): (
            &Value,
            &crate::PartitionGrid,
            &crate::ObjectSettings,
            &Banks,
        ),
    ) -> Result<()> {
        let mut bank = banks.objects.get(&id);
        if let Some(why) = bank.and_then(|banked| scene.unbankable(id, banked.frame)) {
            self.bank_warnings.push((id, why.to_string()));
            bank = None;
        }
        self.bankable
            .extend(bank.map(|banked| (id, banked.item, banked.frame)));
        if !grid.streams {
            return Ok(());
        }
        let batch = roots[id].expect("an object is its batch's or under its root");
        let setting = objects.node(g, id)?;
        if !setting.spatially_loaded {
            self.pinned.insert(batch);
            return Ok(());
        }
        if id == batch {
            let named = setting.runtime_grid.map(|name| (batch, name));
            self.named_grids.extend(named);
        }
        let Some(placed) = scene.place(id, bank)? else {
            return Ok(());
        };
        self.candidates.push(Candidate {
            node: id,
            mesh: scene.mesh_of(id),
            row: placed.row,
            world: placed.world,
            local: placed.local,
            still: placed.still,
            batch,
            grid: 0,
            draw_distance: setting.draw_distance,
            far_field: setting.far_field,
        });
        Ok(())
    }
}

/// The candidates of `table` (`Gathered`), its nodes' `parent`s and whether the scene reaches each
/// (`reached`) given: none with the streaming off (`PartitionGrid::streams`). `objects` says which
/// objects are spatially loaded; `banks`, the instanced skinned objects and the items they play;
/// `source`, its binary and its meshes' boxes, the input scene a plain skinned object's bounds are
/// sampled from (`animated_bounds`).
pub(super) fn gather(
    (g, worlds): (&Value, &[Mat4]),
    (grid, objects, banks): (&crate::PartitionGrid, &crate::ObjectSettings, &Banks),
    source: (&Value, &[u8], &[Option<Box6>]),
    table: &[Value],
    (parent, reached): (&[Option<usize>], &[bool]),
) -> Result<Gathered> {
    let mut scene = Placing::of(g, (table, worlds), (parent, reached), source)?;
    let roots = batch_roots(parent, |id| scene.object(id));
    let mut found = Found {
        bank_warnings: banks.refused.clone(),
        ..Found::default()
    };
    for id in 0..table.len() {
        if scene.object(id) {
            found.visit(id, (&mut scene, &roots), (g, grid, objects, banks))?;
        }
    }
    let Found {
        mut candidates,
        bankable,
        bank_warnings,
        pinned,
        named_grids,
    } = found;
    candidates.retain(|c| !pinned.contains(&c.batch));
    let unknown_grids = assign_grids(&mut candidates, &named_grids, grid);
    let mut batches = BTreeMap::new();
    for c in &candidates {
        grown(&mut batches, c.batch, &c.world);
    }
    Ok(Gathered {
        candidates,
        batches,
        bankable,
        bank_warnings,
        unknown_grids,
    })
}
