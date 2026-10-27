//! `rayTracing.bin` and the manifest's `rayTracing` section.
//!
//! Little-endian: a head (`RAY_TRACING_HEAD_BYTES`) — the magic, the version, the record count, the
//! node count and the triangle count, and three zero words —, a record per primitive
//! (`RAY_TRACING_RECORD_BYTES`): its compiled mesh and its number in the mesh, its flags
//! (`RAY_TRACING_FLAG_*`), the error of its cut in metres (`f32`), the rank of its first node and
//! how many it has, the rank of its first triangle and how many it has (ranks within the file's
//! tables, four `u32`), the low and the high corner of its box (six `f32`), the HLOD cell of an
//! actor's record (else zero) and a zero word. The world's records (`world.rs`) come last, name no
//! primitive (`RAY_TRACING_NO_PRIMITIVE` twice): an HLOD actor's each (`RAY_TRACING_FLAG_ACTOR`),
//! then the directory of the actors (`RAY_TRACING_FLAG_WORLD`), whose entries stand where triangles
//! do. A record of a mesh none of whose primitives is opaque also has
//! `RAY_TRACING_FLAG_ALL_TRANSLUCENT` (`written_flags`).
//! After the records, the nodes of every primitive one after the other, then their triangles
//! (`nodes.rs` lays a node and a triangle out). A node names its internal children and its
//! triangles by ranks from the record's first.
use super::abi::{
    RAY_TRACING_FILE, RAY_TRACING_FLAG_ALL_TRANSLUCENT, RAY_TRACING_FLAG_TRANSLUCENT,
    RAY_TRACING_HEAD_BYTES, RAY_TRACING_MAGIC, RAY_TRACING_NODE_BYTES, RAY_TRACING_NO_PRIMITIVE,
    RAY_TRACING_RECORD_BYTES, RAY_TRACING_TRIANGLE_BYTES, RAY_TRACING_VERSION,
};
use super::tree::{PrimitiveTree, Traced};
use super::word::word;
use crate::Result;
use serde_json::{json, Value};
use std::collections::HashSet;

/// The flags each of `trees` is written with: its own, and `RAY_TRACING_FLAG_ALL_TRANSLUCENT` when
/// it is translucent and so is every primitive of its mesh, a mesh the rays leave out whole. An HLOD
/// actor names no mesh and is one of one material, so its own flag says it.
fn written_flags(trees: &[&PrimitiveTree]) -> Vec<u32> {
    let opaque: HashSet<u32> = (trees.iter())
        .map(|tree| tree.traced)
        .filter(|traced| traced.flags & RAY_TRACING_FLAG_TRANSLUCENT == 0)
        .map(|traced| traced.mesh)
        .collect();
    (trees.iter())
        .map(|tree| {
            let Traced { mesh, flags, .. } = tree.traced;
            let translucent = flags & RAY_TRACING_FLAG_TRANSLUCENT != 0;
            let whole = mesh == RAY_TRACING_NO_PRIMITIVE || !opaque.contains(&mesh);
            flags | RAY_TRACING_FLAG_ALL_TRANSLUCENT * u32::from(translucent && whole)
        })
        .collect()
}

/// The file holding `trees`; an error when a count or a rank does not fit the file's 32-bit words.
pub(super) fn encode(trees: &[&PrimitiveTree]) -> Result<Vec<u8>> {
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
        word(trees.len(), "records")?,
        word(nodes, "nodes")?,
        word(triangles, "triangles")?,
        0,
        0,
        0,
    ];
    for word in head {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    let (mut first_node, mut first_triangle) = (0, 0);
    for (tree, flags) in trees.iter().zip(written_flags(trees)) {
        let Traced {
            mesh,
            primitive,
            cell,
            ..
        } = tree.traced;
        let ranks = [
            mesh,
            primitive,
            flags,
            tree.error.to_bits(),
            word(first_node, "node rank")?,
            word(tree.node_count(), "node count")?,
            word(first_triangle, "triangle rank")?,
            word(tree.triangle_count(), "triangle count")?,
        ];
        let boxed = tree.low.into_iter().chain(tree.high).map(f32::to_bits);
        for word in ranks.into_iter().chain(boxed).chain([cell, 0]) {
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
    Ok(bytes)
}

/// The manifest's `rayTracing` section: the file's version, name and size.
pub(super) fn report(bytes: usize) -> Value {
    json!({"version": RAY_TRACING_VERSION, "file": RAY_TRACING_FILE, "bytes": bytes})
}
