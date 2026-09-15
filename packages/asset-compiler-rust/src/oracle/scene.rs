use super::materials;
use crate::compiler_accessor_create::accessor;
use crate::compiler_validate::{required_index, values};
use crate::compiler_world::{transform_point, world_matrices};
use crate::proxy::bvh;
use crate::{CompilerError, Result};
use serde_json::Value;
use std::path::Path;

/// La scène source, dans le monde, avec son propre arbre. Rien ici ne vient du cache : l'oracle
/// relit les triangles de la source, sans coupe, sans simplification et sans proxy.
pub struct World {
    pub triangles: Vec<f32>,
    pub albedo: Vec<u32>,
    pub node_bounds: Vec<f32>,
    pub node_links: Vec<u32>,
}

fn bad(message: impl Into<String>) -> CompilerError {
    CompilerError::new("INVALID_ORACLE_SOURCE", message)
}

/// Le glTF et son binaire. Un `.glb` porte les deux ; un `.gltf` nomme un binaire à côté de lui.
fn read_source(path: &Path) -> Result<(Value, Vec<u8>)> {
    let bytes = std::fs::read(path)?;
    if crate::compiler_source::is_glb(&bytes) {
        return crate::compiler_source::parse_glb(&bytes);
    }
    let g: Value = serde_json::from_slice(&bytes)?;
    let directory = path.parent().unwrap_or(Path::new("."));
    let mut bin = Vec::new();
    for buffer in g
        .get("buffers")
        .and_then(Value::as_array)
        .unwrap_or(&vec![])
    {
        let Some(uri) = buffer.get("uri").and_then(Value::as_str) else {
            return Err(bad("the oracle reads no embedded buffer outside a GLB"));
        };
        if uri.starts_with("data:") {
            return Err(bad("the oracle reads no data URI buffer"));
        }
        bin.extend_from_slice(&std::fs::read(directory.join(uri))?);
    }
    Ok((g, bin))
}

/// Les triangles monde d'une primitive, ajoutés tels quels avec l'albédo de son matériau.
fn place_primitive(
    g: &Value,
    bin: &[u8],
    primitive: &Value,
    matrix: &crate::compiler_world::Mat4,
    colour: u32,
    world: &mut World,
) -> Result<()> {
    let attributes = primitive
        .get("attributes")
        .and_then(Value::as_object)
        .ok_or_else(|| bad("primitive.attributes is absent"))?;
    // Aucun plan de tampons ici : l'oracle lit une scène brute, donc chaque accessor est validé.
    let positions = accessor(
        g,
        bin,
        required_index(attributes.get("POSITION"), "POSITION")?,
        None,
    )?;
    let points = positions.collect_f32()?;
    let indices: Vec<u32> = match primitive.get("indices") {
        Some(id) => accessor(g, bin, required_index(Some(id), "indices")?, None)?.collect_u32()?,
        None => (0..positions.count as u32).collect(),
    };
    if !indices.len().is_multiple_of(3) {
        return Err(bad("an index count is not a multiple of three"));
    }
    for index in &indices {
        let base = *index as usize * 3;
        let point = points
            .get(base..base + 3)
            .ok_or_else(|| bad("an index points outside POSITION"))?;
        let placed = transform_point(matrix, [point[0] as f64, point[1] as f64, point[2] as f64]);
        world.triangles.push(placed[0] as f32);
        world.triangles.push(placed[1] as f32);
        world.triangles.push(placed[2] as f32);
    }
    world.albedo.resize(world.triangles.len() / 9, colour);
    Ok(())
}

/// Toute la scène, nœud par nœud, avec son BVH. Le même arbre que le proxy, sur d'autres triangles :
/// c'est la structure d'accélération qui est partagée, jamais la géométrie ni la coupe.
pub fn load(path: &Path) -> Result<World> {
    let (g, bin) = read_source(path)?;
    let matrices = world_matrices(&g)?;
    let nodes = values(&g, "nodes")?;
    let meshes = values(&g, "meshes")?;
    let palette = materials::palette(&g, path);
    let mut world = World {
        triangles: Vec::new(),
        albedo: Vec::new(),
        node_bounds: Vec::new(),
        node_links: Vec::new(),
    };
    for (id, node) in nodes.iter().enumerate() {
        let Some(mesh) = node.get("mesh").and_then(Value::as_u64) else {
            continue;
        };
        let mesh = meshes
            .get(mesh as usize)
            .ok_or_else(|| bad("node.mesh is out of bounds"))?;
        for primitive in values(mesh, "primitives")? {
            if primitive.get("mode").and_then(Value::as_u64).unwrap_or(4) != 4 {
                continue;
            }
            let colour = palette.of(primitive.get("material"));
            place_primitive(&g, &bin, primitive, &matrices[id], colour, &mut world)?;
        }
    }
    if world.albedo.is_empty() {
        return Err(bad("the source carries no triangle the oracle can trace"));
    }
    let (node_bounds, node_links) =
        bvh::flatten(&bvh::build(&mut world.triangles, &mut world.albedo));
    world.node_bounds = node_bounds;
    world.node_links = node_links;
    Ok(world)
}
