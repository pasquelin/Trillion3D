//! `rayTracing.bin` and the manifest's `rayTracing` section.
//!
//! Little-endian: a head (`RAY_TRACING_HEAD_BYTES`) — the magic, the version, the record count, the
//! node count and the triangle count, and three zero words —, a record per primitive
//! (`RAY_TRACING_RECORD_BYTES`): its compiled mesh and its number in the mesh, its flags
//! (`RAY_TRACING_FLAG_*`), the error of its cut in metres (`f32`), the rank of its first node and
//! how many it has, the rank of its first triangle and how many it has (ranks within the file's
//! tables, four `u32`), the low and the high corner of its box (six `f32`) and two zero words.
//! After the records, the nodes of every primitive one after the other, then their triangles
//! (`nodes.rs` lays a node and a triangle out). A node names its internal children and its
//! triangles by ranks from the record's first.
use super::abi::{
    RAY_TRACING_FILE, RAY_TRACING_HEAD_BYTES, RAY_TRACING_MAGIC, RAY_TRACING_NODE_BYTES,
    RAY_TRACING_RECORD_BYTES, RAY_TRACING_TRIANGLE_BYTES, RAY_TRACING_VERSION,
};
use super::tree::{PrimitiveTree, Traced};
use serde_json::{json, Value};

/// The file holding `trees`.
pub(super) fn encode(trees: &[&PrimitiveTree]) -> Vec<u8> {
    let nodes: usize = trees.iter().map(|tree| tree.node_count()).sum();
    let triangles: usize = trees.iter().map(|tree| tree.triangle_count()).sum();
    let mut bytes = Vec::with_capacity(
        RAY_TRACING_HEAD_BYTES
            + trees.len() * RAY_TRACING_RECORD_BYTES
            + nodes * RAY_TRACING_NODE_BYTES
            + triangles * RAY_TRACING_TRIANGLE_BYTES,
    );
    let head = [
        RAY_TRACING_MAGIC,
        RAY_TRACING_VERSION,
        trees.len() as u32,
        nodes as u32,
        triangles as u32,
        0,
        0,
        0,
    ];
    for word in head {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    let (mut first_node, mut first_triangle) = (0, 0);
    for tree in trees {
        let Traced {
            mesh,
            primitive,
            flags,
        } = tree.traced;
        let ranks = [
            mesh,
            primitive,
            flags,
            tree.error.to_bits(),
            first_node as u32,
            tree.node_count() as u32,
            first_triangle as u32,
            tree.triangle_count() as u32,
        ];
        let boxed = tree.low.into_iter().chain(tree.high).map(f32::to_bits);
        for word in ranks.into_iter().chain(boxed).chain([0, 0]) {
            bytes.extend_from_slice(&word.to_le_bytes());
        }
        first_node += tree.node_count();
        first_triangle += tree.triangle_count();
    }
    debug_assert_eq!(
        bytes.len(),
        RAY_TRACING_HEAD_BYTES + trees.len() * RAY_TRACING_RECORD_BYTES
    );
    for tree in trees {
        bytes.extend_from_slice(&tree.nodes);
    }
    for tree in trees {
        bytes.extend_from_slice(&tree.triangles);
    }
    bytes
}

/// The manifest's `rayTracing` section: the file's version, name and size.
pub(super) fn report(bytes: usize) -> Value {
    json!({"version": RAY_TRACING_VERSION, "file": RAY_TRACING_FILE, "bytes": bytes})
}
