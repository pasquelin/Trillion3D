use super::materials;
use crate::compiler::source::node_transform::world_matrices;
use crate::compiler::validate::values;
use crate::trace::tracer::World;
use crate::{CompilerError, Result};
use serde_json::Value;
use std::path::Path;
use trillion3d_math::matrix::transform_point_f32;
use trillion3d_page_codec::proxy::bvh;

fn bad(message: impl Into<String>) -> CompilerError {
    CompilerError::new("INVALID_ORACLE_SOURCE", message)
}

/// World triangles of a primitive, added as-is with its material's albedo.
fn place_primitive(
    g: &Value,
    bin: &[u8],
    primitive: &Value,
    matrix: &crate::compiler::source::node_transform::Mat4,
    colour: u32,
    world: &mut World,
) -> Result<()> {
    // No buffer map here: the oracle reads a raw scene, so each accessor is validated.
    let (positions, indices, _) =
        crate::compiler::primitive::triangles::read(g, bin, primitive, None)?;
    let points = positions.collect_f32()?;
    for index in &indices {
        let at = *index as usize * 3;
        let placed = transform_point_f32(matrix, [0, 1, 2].map(|axis| points[at + axis]));
        world.triangles.extend(placed);
    }
    world.tags.resize(world.triangles.len() / 9, colour);
    Ok(())
}

/// The entire scene, node by node, with its BVH. Same tree as proxy, over different triangles:
/// acceleration structure is shared, never geometry or cuts.
pub fn load(path: &Path) -> Result<World> {
    let (mut g, binary) = crate::compiler::source::flat_document(path)?;
    let bin = binary.bytes();
    // The compiled scene draws every GPU instance; the reference world must hold them too.
    crate::compiler::source::instancing::expand_gpu_instances(&mut g, bin)?;
    let matrices = world_matrices(&g)?;
    let nodes = values(&g, "nodes")?;
    let meshes = values(&g, "meshes")?;
    let palette = materials::palette(&g, bin, path);
    let mut world = World {
        triangles: Vec::new(),
        tags: Vec::new(),
        node_bounds: Vec::new(),
        node_links: Vec::new(),
    };
    // A hidden node is not drawn: the reference traces what the compiled scene shows.
    let (_, hidden) = crate::compiler::source::nodes::scene_nodes(&g)?;
    for (id, node) in nodes.iter().enumerate() {
        let Some(mesh) = node.get("mesh").and_then(Value::as_u64) else {
            continue;
        };
        if hidden.contains(&id) {
            continue;
        }
        let mesh = meshes
            .get(mesh as usize)
            .ok_or_else(|| bad("node.mesh is out of bounds"))?;
        for primitive in values(mesh, "primitives")? {
            if primitive.get("mode").and_then(Value::as_u64).unwrap_or(4) != 4 {
                continue;
            }
            let colour = palette.of(primitive.get("material"));
            place_primitive(&g, bin, primitive, &matrices[id], colour, &mut world)?;
        }
    }
    if world.tags.is_empty() {
        return Err(bad("the source carries no triangle the oracle can trace"));
    }
    let (node_bounds, node_links) =
        bvh::flatten(&bvh::build(&mut world.triangles, &mut world.tags));
    world.node_bounds = node_bounds;
    world.node_links = node_links;
    Ok(world)
}
