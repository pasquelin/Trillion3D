//! The tables that describe the prepared scene: its node graph with the local pose of every node,
//! the cameras it carries, the surfaces it wears and, per published document, the geometry layout of
//! every primitive. A cache product under its own name, beside `lights.json`, from which
//! `packages/sdk-browser/src/scene/drive/scene.ts` builds the scene the engine draws — no glTF is
//! parsed at runtime.
//!
//! Source of every value: the glTF this same compilation publishes as `source.gltf` — after the
//! slice kept its nodes, after the cutout answers rewrote their materials, after the mesh ranks
//! were remapped. Anything read from the input document instead would describe a scene nobody
//! draws.
//!
//! No lamp is written here: `lights.json` (`lights.rs`) is the one reading of a light —
//! its type, colour, intensity, range, cone and world transform — and the one policy on a light it
//! cannot read (counted in `rejected`, never a failed compile).
use crate::hlod::options::Assigned;
use crate::*;
use serde_json::Map;

pub(crate) mod displacement;
mod documents;
mod graph;
pub(crate) mod materials;
mod motion;
pub(crate) mod partition;
mod physical;
mod sparse;
mod textures;
pub(crate) mod uv_density;
use documents::document_table;
use graph::{camera_table, name_of, node_table, scene_roots};
use materials::material_entry;
use textures::texture_table;

/// Version of the `scene-tables.json` cache product. It lives outside the manifest: its version is
/// its own, and the tables it carries are versioned each in turn. Version 2 carries the whole
/// scene graph and the geometry layout, which is what lets the runtime build the scene without a
/// glTF parse; version 3 moves the nodes that only place a mesh into spatial cells read by
/// distance (`partition.rs`), and the node table keeps the others, renumbered; version 4 keeps
/// only the root of the cells' index, whose pages lie beside it (`partition/pages.rs`); version 5
/// names the manifest's mesh pages the node table needs (`meshPages`), which a runtime reads at open
/// while the cells' own are read with them (#751).
/// Version 6 carries the skins and the animation clips (`motion.rs`, #357). Version 7 lays out the
/// one published document (`document`), no longer a map of documents by name (#1483). Version 8
/// carries no `lights`: they were a second, raw reading of `KHR_lights_punctual` that failed the
/// compile on a type `lights.json` counts as rejected; `lights.json` is now their only product.
/// Version 9 names the table rank of each flattened material the world's HLOD actors wear
/// (`hlodMaterials`, `../hlod/flatten`).
const SCENE_TABLES_VERSION: u32 = 9;
/// The node table's version: 4 says whether each node declares itself visible
/// (`KHR_node_visibility`), 5 names the skin a node bends its mesh by, 6 names no light, 7 says
/// which animated nodes stream — their mesh drawn only by their cell's row, their own host mesh
/// its animation source (`"streamed": true`) — and names the item of the scene's animation banks
/// an instanced skinned node the core keeps plays, hung under its skin's frame at no pose
/// (`"bank"`, `partition.rs`).
const NODE_TABLE_VERSION: u32 = 7;
/// The material table's version. An entry's `temporalAntialiasing`, its history share written only
/// below 1, is optional: a reader that does not know it reads the material as before. Version 5
/// names the share in place of version 4's `responsive: true`.
const MATERIAL_TABLE_VERSION: u32 = 5;
const GEOMETRY_TABLE_VERSION: u32 = 1;
const SCENE_TABLES_FILE: &str = "scene-tables.json";

/// The material table, filled as the document meets the surfaces that are actually worn. A
/// glTF material is one entry per tangent variant: that is how many the runtime builds of it, and an
/// entry nothing wears would describe a surface no pixel is drawn with. `shares` gives, by glTF
/// material rank, the most of its history the temporal anti-aliasing keeps on its pixels
/// (`MaterialOptions::history_shares`): an entry below 1 carries it as `"temporalAntialiasing"`,
/// the others no field at all.
struct Materials {
    table: Vec<Value>,
    interned: BTreeMap<(Option<usize>, bool), usize>,
    shares: Vec<f64>,
    /// The UV density of each displaced glTF material, by rank (`uv_density`): written into its
    /// entry's `displacement` as `uvDensities`, which no other entry carries.
    densities: BTreeMap<usize, [f64; uv_density::UV_SETS]>,
}
impl Materials {
    /// Rank in the table of the surface a primitive wears; a primitive that declares no material
    /// wears the glTF default one, which the runtime builds just the same.
    fn rank(&mut self, g: &Value, primitive: &Value) -> Result<usize> {
        let declared = match primitive.get("material") {
            Some(value) => Some(required_index(Some(value), "primitive.material")?),
            None => None,
        };
        let key = (declared, primitive.pointer("/attributes/TANGENT").is_none());
        if let Some(rank) = self.interned.get(&key) {
            return Ok(*rank);
        }
        let source = match declared {
            Some(id) => item(values(g, "materials")?, id, "material")?.clone(),
            None => json!({}),
        };
        let mut entry = material_entry(&source, key.1);
        if let Some(&share) = declared
            .and_then(|id| self.shares.get(id))
            .filter(|s| **s < 1.0)
        {
            entry[TEMPORAL_AA_EXTRA] = json!(share);
        }
        // A displaced material says so in its entry, and no other has the field.
        if let Some(displaced) = displacement::displacement(&source)? {
            entry[DISPLACEMENT_EXTRA] = displaced;
            if let Some(density) = declared.and_then(|id| self.densities.get(&id)) {
                entry[DISPLACEMENT_EXTRA]["uvDensities"] = json!(density);
            }
        }
        self.table.push(entry);
        self.interned.insert(key, self.table.len() - 1);
        Ok(self.table.len() - 1)
    }
}

/// The HLOD materials the world adds to the published scene once its cells are known: the scene
/// with their images, textures and materials appended, and the glTF rank of each, in the order
/// the world's clusters name them (`hlod/chain.rs`).
pub(crate) type WorldMaterials = Option<(Value, Vec<usize>)>;

/// What the partition reads of the job: its HLOD, each node's HLOD layer, its main grid and its
/// object settings.
type PartitionInputs<'a> = (
    &'a crate::Hlod,
    &'a [Assigned],
    &'a crate::PartitionGrid,
    &'a crate::ObjectSettings,
);

/// What `stage_scene_tables` returns: the tables' product, the animation banks' product with its
/// descriptor, the published nodes each cell places, and the published scene.
type StagedTables = (
    Product,
    Option<(Product, Value)>,
    partition::CellMembers,
    Option<Value>,
);

/// Compilation stage: the tables come out as a cache product under their own name, outside the
/// manifest, written from the scene this job publishes. The partition's region pages name the mesh
/// pages of `mesh_pages`; `world` places the published nodes, computed once for the job
/// (`proxy::placement::Placement`). The clips the job's instanced skinned objects play
/// (`objects`, `ObjectSettings`) are baked once, before the partition places them, from the input
/// scene `g` and its binary, `mesh_map` giving each mesh's published rank
/// (`motion::bank::bake_banks`): written as `animation-banks.bin` when an object plays one. Once
/// the partition is known, `world_roots` builds the world's HLOD from its cells and may add the
/// materials it flattens: the tables then describe the scene with them, and name each one's table
/// rank (`hlodMaterials`). Returned beside the product: the animation banks' product and the
/// descriptor the manifest names it by (`animationBanks`), none for a scene with no item; the
/// published nodes each cell places, with its HLOD 0 cell (`partition::CellMembers`); and the
/// published scene the tables describe. The cells stream on the job's main `grid`, their files
/// written in `directory` by the job's `pool`. `assignments` is each node's HLOD layer, read once
/// for the job (`Hlod::assignments`).
pub(crate) fn stage_scene_tables(
    (g, bin, (hlod, assignments, grid, objects), materials): (
        &Value,
        &[u8],
        PartitionInputs<'_>,
        &crate::MaterialOptions,
    ),
    (published, world, mesh_map): (
        &Value,
        &[crate::compiler::source::node_transform::Mat4],
        &BTreeMap<usize, usize>,
    ),
    mesh_pages: &crate::compiler::pages::manifest::MeshPages,
    (directory, pool): (&Path, &rayon::ThreadPool),
    progress: impl Fn(Value),
    world_roots: impl FnOnce(&partition::CellMembers) -> Result<WorldMaterials>,
) -> Result<StagedTables> {
    let started = Instant::now();
    let mut table = node_table(published, objects)?;
    let mut roots =
        crate::compiler::source::nodes::scene_roots(published, values(published, "nodes")?)?;
    // The input scene's meshes' boxes, by its own ranks: what the banks' and the plain skinned
    // objects' bounds grow from.
    let boxes = partition::boxes::mesh_boxes(g);
    let banks = motion::bank::bake_banks(g, bin, objects, &boxes, mesh_map)?;
    let animation_banks = match &banks.file {
        Some(bytes) => {
            let written = product(directory, motion::bank::ANIMATION_BANKS_FILE, bytes)?;
            let descriptor = json!({"url": written.name, "bytes": written.bytes,
                "version": motion::bank::ANIMATION_BANKS_VERSION, "sha256": written.sha256,
                "items": banks.items});
            Some((written, descriptor))
        }
        None => None,
    };
    let (split, members) = partition::partition(
        (published, world),
        (hlod, assignments, grid),
        (objects, &banks, (g, bin, &boxes)),
        (&mut table, &mut roots),
        &mesh_pages.by_mesh,
        (directory, pool),
    )?;
    let flattened = world_roots(&members)?;
    let (described, hlod) = match &flattened {
        Some((scene, ranks)) => (scene, ranks.as_slice()),
        None => (published, &[][..]),
    };
    let mut surfaces = Materials {
        table: Vec::new(),
        interned: BTreeMap::new(),
        shares: materials.history_shares(described)?,
        densities: uv_density::by_material(g, bin, mesh_map.keys().copied())?,
    };
    let document = document_table(described, "source.bin", &mut surfaces)?;
    // Each flattened material's entry in its no-tangent variant: a merged actor's pages hold no
    // tangents, an approximated shell's do (`hlod/chain/pages.rs`), and there each cluster's
    // tangent flag picks the stored-frame normal factor (`tangentNormalScaleY`), so one entry
    // serves both.
    let hlod_materials: Vec<usize> = hlod
        .iter()
        .map(|&id| surfaces.rank(described, &json!({"material": id})))
        .collect::<Result<_>>()?;
    let (mut skins, mut animations) = (
        motion::skin_table(g, bin)?,
        motion::animation_table(g, bin)?,
    );
    let (nodes, roots, partition, cells) = match split {
        Some(split) => {
            motion::renumber(&mut skins, &mut animations, &split.rank);
            (split.nodes, split.roots, split.partition, split.cells)
        }
        None => (table, roots, Value::Null, 0),
    };
    let cameras = camera_table(published)?;
    let textures = texture_table(described);
    let counts = json!({"nodes":nodes.len(),"cells":cells,"materials":surfaces.table.len(),"textures":textures.len()});
    let tables = json!({
        "version": SCENE_TABLES_VERSION,
        "nodeTableVersion": NODE_TABLE_VERSION,
        "materialTableVersion": MATERIAL_TABLE_VERSION,
        "geometryTableVersion": GEOMETRY_TABLE_VERSION,
        "scene": scene_roots(published, roots)?,
        "nodes": nodes,
        "partition": partition,
        "meshPages": core_pages(&nodes, &mesh_pages.by_mesh),
        "cameras": cameras,
        "skins": skins,
        "animations": animations,
        "materials": surfaces.table,
        "textures": textures,
        "document": document,
        "hlodMaterials": hlod_materials,
    });
    let written = product(directory, SCENE_TABLES_FILE, &serde_json::to_vec(&tables)?)?;
    progress(
        json!({"phase":"tables","completed":1,"total":1,"ms":shared_math::elapsed_ms(started),"counts":counts}),
    );
    Ok((
        written,
        animation_banks,
        members,
        flattened.map(|(scene, _)| scene),
    ))
}

/// The slots of the mesh pages the meshes `nodes` draw lie in, sorted and each once: what a runtime
/// reads before its first frame, the cells naming the rest (#751).
fn core_pages(nodes: &[Value], by_mesh: &partition::pages::MeshSlots) -> Vec<String> {
    let meshes = nodes.iter().filter_map(|node| node["mesh"].as_u64());
    partition::pages::slots_of(meshes, by_mesh)
        .into_iter()
        .cloned()
        .collect()
}

/// The cell records of the tables in `directory` by file name, read through their partition's pages,
/// each proven by its slot: a reused folder proves its cells so (`cache/reuse_proof.rs`), the
/// manifest's `files` would grow with the world. Tables of another version are refused by name.
pub(crate) fn cell_records(directory: &Path) -> std::result::Result<Map<String, Value>, String> {
    let what = |e: &dyn std::fmt::Display| format!("{SCENE_TABLES_FILE}: {e}");
    let bytes = fs::read(directory.join(SCENE_TABLES_FILE)).map_err(|e| what(&e))?;
    let tables: Value = serde_json::from_slice(&bytes).map_err(|e| what(&e))?;
    if tables["version"] != json!(SCENE_TABLES_VERSION) {
        return Err("scene tables of another version".into());
    }
    let records = match &tables["partition"] {
        Value::Null => Vec::new(),
        root => partition::pages::read_records(directory, root)?,
    };
    let named = |cell: Value| (cell["url"].as_str().unwrap_or_default().to_string(), cell);
    Ok(records.into_iter().map(named).collect())
}
