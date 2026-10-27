//! A primitive's tree, built and encoded: its DAG's coarse cut (`cut.rs`), the binary tree over
//! the cut's triangles (`bvh.rs`) collapsed into eight children a node (`wide.rs`), as bytes
//! (`nodes.rs`), ready for the file (`encode.rs`).
use super::abi::{
    RAY_TRACING_FLAG_MASKED, RAY_TRACING_FLAG_TRANSLUCENT, RAY_TRACING_FLAG_TWO_SIDED,
    RAY_TRACING_NODE_BYTES, RAY_TRACING_TRIANGLE_BYTES,
};
use super::bvh::{build, Item};
use super::cut::cut_of;
use super::nodes::{write_node, write_triangle};
use super::wide::collapse;
use crate::compiler::materials::AlphaMode;
use crate::dag::DagCluster;
use serde_json::Value;

/// What names a primitive's tree and says how a ray treats it: the primitive's compiled mesh and
/// its number in the mesh, the two numbers a placed root names its primitive by, and the flags of
/// its material (`material_flags`).
#[derive(Clone, Copy, Default)]
pub(crate) struct Traced {
    pub mesh: u32,
    pub primitive: u32,
    pub flags: u32,
}

/// The tree of a primitive: what names it, the error of its cut, the box of its triangles, and the
/// bytes of its nodes and of its triangles.
pub(crate) struct PrimitiveTree {
    pub(super) traced: Traced,
    pub(super) error: f32,
    pub(super) low: [f32; 3],
    pub(super) high: [f32; 3],
    pub(super) nodes: Vec<u8>,
    pub(super) triangles: Vec<u8>,
}

impl PrimitiveTree {
    pub(super) fn node_count(&self) -> usize {
        self.nodes.len() / RAY_TRACING_NODE_BYTES
    }

    pub(super) fn triangle_count(&self) -> usize {
        self.triangles.len() / RAY_TRACING_TRIANGLE_BYTES
    }
}

/// The flags of a primitive drawn with `material` (none for a primitive without one): whether it
/// is double-sided, alpha-masked, or translucent — `translucent` is the engine's own judgement,
/// blended or transmissive (`drawn_blended`).
pub(crate) fn material_flags(material: Option<&Value>, translucent: bool) -> u32 {
    let two_sided = material.is_some_and(|m| m["doubleSided"].as_bool() == Some(true));
    let masked = material.is_some_and(|m| matches!(AlphaMode::of(m), AlphaMode::Mask(_)));
    (u32::from(two_sided) * RAY_TRACING_FLAG_TWO_SIDED)
        | (u32::from(masked) * RAY_TRACING_FLAG_MASKED)
        | (u32::from(translucent) * RAY_TRACING_FLAG_TRANSLUCENT)
}

/// The tree of the primitive `traced` names, whose DAG is `clusters`, over the vertices
/// `positions`; none when its cut holds no triangle.
pub(crate) fn primitive_tree(
    positions: &[f32],
    clusters: &[DagCluster],
    traced: Traced,
) -> Option<PrimitiveTree> {
    let cut = cut_of(positions, clusters);
    if cut.triangles.is_empty() {
        return None;
    }
    let items: Vec<Item> = cut.triangles.iter().map(Item::of).collect();
    let binary = build(&items);
    let wide = collapse(&binary);
    let (low, high) = binary.nodes[0].bounds;
    let mut nodes = Vec::with_capacity(wide.nodes.len() * RAY_TRACING_NODE_BYTES);
    for node in &wide.nodes {
        write_node(node, &mut nodes);
    }
    let mut triangles = Vec::with_capacity(wide.triangles.len() * RAY_TRACING_TRIANGLE_BYTES);
    for &item in &wide.triangles {
        write_triangle(&cut.triangles[item], &mut triangles);
    }
    Some(PrimitiveTree {
        traced,
        error: cut.error,
        low,
        high,
        nodes,
        triangles,
    })
}
