//! The tables that describe the prepared scene: its node graph with the local pose of every node,
//! the lights and cameras it hangs, the surfaces it wears and, per published document, the geometry layout of
//! every primitive. A cache product under its own name, beside `lights.json`, from which
//! `packages/sdk-browser/src/world/scene/scene.ts` builds the scene the engine draws — no glTF is
//! parsed at runtime.
//!
//! Source of every value: the glTF this same compilation publishes as `source.gltf` — after the
//! slice kept its nodes, after the cutout answers rewrote their materials, after the mesh ranks
//! were remapped — and, when one is written, the autonomous `scene.gltf` derived from it. Anything
//! read from the input document instead would describe a scene nobody draws.
use super::*;

mod documents;
mod graph;
mod materials;
mod physical;
mod sparse;
mod textures;
use documents::document_table;
use graph::{camera_table, light_table, node_table, scene_roots};
use materials::material_entry;
use textures::texture_table;

/// Version of the `scene-tables.json` cache product. It lives outside the manifest: its version is
/// its own, and the tables it carries are versioned each in turn. Version 2 carries the whole
/// scene graph and the geometry layout, which is what lets the runtime build the scene without a
/// glTF parse.
const SCENE_TABLES_VERSION: u32 = 2;
const NODE_TABLE_VERSION: u32 = 2;
const MATERIAL_TABLE_VERSION: u32 = 4;
const GEOMETRY_TABLE_VERSION: u32 = 1;
const SCENE_TABLES_FILE: &str = "scene-tables.json";

/// The material table, filled as the documents meet the surfaces that are actually worn. A
/// glTF material is one entry per tangent variant: that is how many the host builds of it, and an
/// entry nothing wears would describe a surface no pixel is drawn with.
struct Materials {
    table: Vec<Value>,
    interned: BTreeMap<(Option<usize>, bool), usize>,
}
impl Materials {
    /// Rank in the table of the surface a primitive wears; a primitive that declares no material
    /// wears the glTF default one, which the host builds just the same.
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
        self.table.push(material_entry(&source, key.1));
        self.interned.insert(key, self.table.len() - 1);
        Ok(self.table.len() - 1)
    }
}

/// Compilation stage: the tables come out as a cache product under their own name, outside the
/// manifest, written from the scene this job publishes and from its autonomous copy when one was
/// written. Both documents share one node graph and one material
/// table: the autonomous scene is the published one with its geometry reduced, so only the
/// geometry layout differs.
pub(super) fn stage_scene_tables(
    published: &Value,
    autonomous: Option<&Value>,
    directory: &Path,
    progress: impl Fn(Value),
) -> Result<Product> {
    let started = Instant::now();
    let mut surfaces = Materials {
        table: Vec::new(),
        interned: BTreeMap::new(),
    };
    let mut documents = serde_json::Map::new();
    documents.insert(
        "source.gltf".into(),
        document_table(published, "source.bin", &mut surfaces)?,
    );
    if let Some(scene) = autonomous {
        let name = crate::compiler_autonomous::AUTONOMOUS_SCENE_FILE;
        documents.insert(
            name.into(),
            document_table(scene, "scene.bin", &mut surfaces)?,
        );
    }
    let nodes = node_table(published)?;
    let lights = light_table(published)?;
    let cameras = camera_table(published)?;
    let textures = texture_table(published);
    let counts = json!({"nodes":nodes.len(),"materials":surfaces.table.len(),"textures":textures.len(),"lights":lights.len(),"documents":documents.len()});
    let tables = json!({
        "version": SCENE_TABLES_VERSION,
        "nodeTableVersion": NODE_TABLE_VERSION,
        "materialTableVersion": MATERIAL_TABLE_VERSION,
        "geometryTableVersion": GEOMETRY_TABLE_VERSION,
        "scene": scene_roots(published)?,
        "nodes": nodes,
        "lights": lights,
        "cameras": cameras,
        "materials": surfaces.table,
        "textures": textures,
        "documents": documents,
    });
    let written = product(directory, SCENE_TABLES_FILE, &serde_json::to_vec(&tables)?)?;
    progress(
        json!({"phase":"tables","completed":1,"total":1,"ms":shared_math::elapsed_ms(started),"counts":counts}),
    );
    Ok(written)
}
