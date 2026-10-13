use crate::compiler_validate::{item, required_index, values};
use crate::compiler_world::{world_matrices, Mat4};
use crate::Result;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use trillion3d_math::linear::longest_column;
use trillion3d_math::matrix::transform_point;

/// Max world scale under which each source mesh placed. Primitive placed
/// twice at two scales takes largest: cut finer than needed for
/// other instance, never coarser than threshold allows.
pub fn mesh_scales(g: &Value, chosen: &BTreeSet<usize>) -> Result<BTreeMap<usize, f64>> {
    let world = world_matrices(g)?;
    let nodes = values(g, "nodes")?;
    let mut scales: BTreeMap<usize, f64> = BTreeMap::new();
    for node_id in chosen {
        let node = item(nodes, *node_id, "node")?;
        let mesh = required_index(node.get("mesh"), "node.mesh")?;
        let scale = longest_column(&world[*node_id]);
        let slot = scales.entry(mesh).or_insert(0.0);
        if scale > *slot {
            *slot = scale;
        }
    }
    Ok(scales)
}

/// Compiled primitives of each mesh, in original order: without table, each
/// retained node would sweep all scene primitives to find own.
pub(crate) fn primitives_by_mesh(primitives: &[Value]) -> BTreeMap<u64, Vec<usize>> {
    let mut by_mesh: BTreeMap<u64, Vec<usize>> = BTreeMap::new();
    for (index, primitive) in primitives.iter().enumerate() {
        if let Some(mesh) = primitive.get("mesh").and_then(Value::as_u64) {
            by_mesh.entry(mesh).or_default().push(index);
        }
    }
    by_mesh
}

/// Cut vertices, transformed once by placing node.
pub(crate) fn place(cut: &[f32], matrix: &Mat4, out: &mut Vec<f32>) {
    out.reserve(cut.len());
    for vertex in cut.as_chunks::<3>().0 {
        let world = transform_point(matrix, vertex.map(f64::from));
        out.push(world[0] as f32);
        out.push(world[1] as f32);
        out.push(world[2] as f32);
    }
}
