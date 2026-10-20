use crate::compiler_validate::{item, required_index, values};
use crate::compiler_world::Mat4;
use crate::Result;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use trillion3d_math::linear::max_stretch;
use trillion3d_math::matrix::transform_point;

/// Where the scene places what it compiled, computed once for every stage that places — the
/// depth layers, the proxy, the lights, the partition, the world roots and the
/// physics —: each walked the hierarchy, and swept the primitives, on its own.
pub struct Placement {
    /// World transform of every node, by node index (`compiler_world::world_matrices`). The
    /// published scene keeps the input's nodes, their order and their transforms: one table
    /// serves both.
    pub(crate) world: Vec<Mat4>,
    /// Compiled primitives of each compiled mesh, in original order: without table, each
    /// retained node would sweep all scene primitives to find own.
    pub(crate) by_mesh: BTreeMap<u64, Vec<usize>>,
}

impl Placement {
    /// The placement of `primitives`, once compiled, by the node transforms `world`.
    pub(crate) fn new(world: Vec<Mat4>, primitives: &[Value]) -> Self {
        let mut by_mesh: BTreeMap<u64, Vec<usize>> = BTreeMap::new();
        for (index, primitive) in primitives.iter().enumerate() {
            if let Some(mesh) = primitive.get("mesh").and_then(Value::as_u64) {
                by_mesh.entry(mesh).or_default().push(index);
            }
        }
        Self { world, by_mesh }
    }
}

/// Max world scale under which each source mesh placed, by the node transforms `world`.
/// Primitive placed twice at two scales takes largest: cut finer than needed for
/// other instance, never coarser than threshold allows.
pub fn mesh_scales(
    g: &Value,
    chosen: &BTreeSet<usize>,
    world: &[Mat4],
) -> Result<BTreeMap<usize, f64>> {
    let nodes = values(g, "nodes")?;
    let mut scales: BTreeMap<usize, f64> = BTreeMap::new();
    for node_id in chosen {
        let node = item(nodes, *node_id, "node")?;
        let mesh = required_index(node.get("mesh"), "node.mesh")?;
        let scale = max_stretch(&world[*node_id]);
        let slot = scales.entry(mesh).or_insert(0.0);
        if scale > *slot {
            *slot = scale;
        }
    }
    Ok(scales)
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
