//! The tables that describe the prepared scene: which node draws which primitive, where, and with
//! what surface. A cache product under its own name, beside `lights.json`, read by
//! `packages/sdk-browser/preparedSceneTables.ts`.
//!
//! Source of every value: the glTF this same compilation publishes as `source.gltf` — after the
//! slice kept its nodes, after the cutout answers rewrote their materials, after the mesh ranks
//! were remapped. That is the document the runtime loads, so the tables and the scene it builds
//! name the same meshes at the same ranks; anything read from the input document instead would
//! describe a scene nobody draws.
use super::*;
use crate::compiler_world::{world_matrices, Mat4};

mod materials;
use materials::{material_entry, texture_table};

/// Version of the `scene-tables.json` cache product. It lives outside the manifest: its version is
/// its own, and the two tables it carries are versioned each in turn.
const SCENE_TABLES_VERSION: u32 = 1;
const NODE_TABLE_VERSION: u32 = 1;
const MATERIAL_TABLE_VERSION: u32 = 1;
const SCENE_TABLES_FILE: &str = "scene-tables.json";

/// Parent of every node, read from `children` once: the table says the hierarchy without the
/// consumer walking it again.
fn parents(nodes: &[Value]) -> Result<Vec<Option<usize>>> {
    let mut parent = vec![None; nodes.len()];
    for id in 0..nodes.len() {
        for child in crate::compiler_nodes::children_of(nodes, id)? {
            parent[child] = Some(id);
        }
    }
    Ok(parent)
}

/// World box of one primitive: the corner values its position accessor declares, through the pose
/// of the node that draws it. `null` when the accessor declares no corner — glTF requires them on
/// `POSITION`, and a document that omits them gets no invented box.
fn world_bounds(g: &Value, primitive: &Value, m: &Mat4) -> Result<Value> {
    let Some(position) = primitive.pointer("/attributes/POSITION") else {
        return Ok(Value::Null);
    };
    let id = required_index(Some(position), "primitive.attributes.POSITION")?;
    let accessor = item(values(g, "accessors")?, id, "accessor")?;
    let corner = |name: &str| {
        accessor
            .get(name)
            .and_then(Value::as_array)
            .filter(|values| values.len() >= 3)
            .map(|values| [0, 1, 2].map(|axis| materials::number(values.get(axis), f64::NAN)))
    };
    let (Some(low), Some(high)) = (corner("min"), corner("max")) else {
        return Ok(Value::Null);
    };
    let (mut min, mut max) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for pick in 0..8u8 {
        let local = [0, 1, 2].map(|axis| match pick >> axis & 1 {
            0 => low[axis],
            _ => high[axis],
        });
        for axis in 0..3 {
            let value = m[axis] * local[0] + m[4 + axis] * local[1] + m[8 + axis] * local[2]
                + m[12 + axis];
            min[axis] = min[axis].min(value);
            max[axis] = max[axis].max(value);
        }
    }
    if !min.iter().chain(max.iter()).all(|v| v.is_finite()) {
        return Ok(Value::Null);
    }
    Ok(json!({"min":min,"max":max}))
}

/// The material table, filled as the node walk meets the surfaces that are actually worn. A
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

/// One entry per drawn primitive: the node that carries it, its pose in world space, the surface
/// it wears and its rank among the copies of that same primitive. Instancing is exactly that rank:
/// several nodes naming one mesh are one geometry drawn at several poses, and nothing else in the
/// table repeats.
fn node_table(g: &Value) -> Result<(Vec<Value>, Vec<Value>)> {
    let nodes = values(g, "nodes")?;
    let (world, parent) = (world_matrices(g)?, parents(nodes)?);
    let meshes = values(g, "meshes")?;
    let mut copies: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    let mut surfaces = Materials {
        table: Vec::new(),
        interned: BTreeMap::new(),
    };
    let mut table = Vec::new();
    for (id, node) in nodes.iter().enumerate() {
        if node.get("mesh").is_none() {
            continue;
        }
        let mesh = required_index(node.get("mesh"), "node.mesh")?;
        for (rank, primitive) in values(item(meshes, mesh, "mesh")?, "primitives")?
            .iter()
            .enumerate()
        {
            let material = surfaces.rank(g, primitive)?;
            let instance = copies.entry((mesh, rank)).or_insert(0);
            table.push(json!({
                "name": node.get("name").and_then(Value::as_str).unwrap_or(""),
                "node": id,
                "parent": parent[id],
                "mesh": mesh,
                "primitive": rank,
                "material": material,
                "instance": *instance,
                "matrix": world[id],
                "bounds": world_bounds(g, primitive, &world[id])?,
            }));
            *instance += 1;
        }
    }
    Ok((table, surfaces.table))
}

/// Compilation stage: the tables come out as a cache product under their own name, outside the
/// manifest, written from the scene this job publishes.
pub(super) fn stage_scene_tables(
    published: &Value,
    directory: &Path,
    progress: impl Fn(Value),
) -> Result<Product> {
    let started = Instant::now();
    let (nodes, materials) = node_table(published)?;
    let textures = texture_table(published);
    let counts = json!({"nodes":nodes.len(),"materials":materials.len(),"textures":textures.len()});
    let tables = json!({
        "version": SCENE_TABLES_VERSION,
        "nodeTableVersion": NODE_TABLE_VERSION,
        "materialTableVersion": MATERIAL_TABLE_VERSION,
        "nodes": nodes,
        "materials": materials,
        "textures": textures,
    });
    let written = product(directory, SCENE_TABLES_FILE, &serde_json::to_vec(&tables)?)?;
    progress(
        json!({"phase":"tables","completed":1,"total":1,"ms":shared_math::elapsed_ms(started),"counts":counts}),
    );
    Ok(written)
}
