//! The file holds a head, the records, the nodes and the triangles; a material sets the flags.
use super::cluster;
use crate::ray_tracing::abi::*;
use crate::ray_tracing::encode::{encode, report};
use crate::ray_tracing::tree::{material_flags, primitive_tree, PrimitiveTree, Traced};
use crate::support::le::u32_at;
use serde_json::json;

#[test]
fn the_file_holds_a_head_the_records_the_nodes_and_the_triangles() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0];
    let dag = [cluster(vec![0, 1, 2, 0, 2, 3], (0.0, f64::INFINITY), false)];
    let traced = Traced {
        mesh: 3,
        primitive: 4,
        flags: RAY_TRACING_FLAG_MASKED,
    };
    let tree = primitive_tree(&positions, &dag, traced).expect("two triangles");
    assert_eq!(tree.node_count(), 1);
    assert_eq!(tree.triangle_count(), 2);
    let trees = [None, Some(tree), None];
    let held: Vec<&PrimitiveTree> = trees.iter().flatten().collect();
    let bytes = encode(&held);
    let expected = RAY_TRACING_HEAD_BYTES
        + RAY_TRACING_RECORD_BYTES
        + RAY_TRACING_NODE_BYTES
        + 2 * RAY_TRACING_TRIANGLE_BYTES;
    assert_eq!(bytes.len(), expected);
    let word = |at: usize| u32_at(&bytes, at).unwrap();
    assert_eq!(&bytes[..4], b"T3RT");
    assert_eq!(
        [word(4), word(8), word(12), word(16)],
        [RAY_TRACING_VERSION, 1, 1, 2]
    );
    let record = RAY_TRACING_HEAD_BYTES;
    // The primitive's compiled mesh and its number in the mesh, its flags, then its nodes and
    // triangles.
    assert_eq!(
        [word(record), word(record + 4), word(record + 8)],
        [3, 4, RAY_TRACING_FLAG_MASKED]
    );
    let ranks = [16, 20, 24, 28].map(|at| word(record + at));
    assert_eq!(ranks, [0, 1, 0, 2]);
    // The words after the box are zero.
    assert_eq!([word(record + 56), word(record + 60)], [0, 0]);
    assert_eq!(
        report(bytes.len()),
        json!({"version": RAY_TRACING_VERSION, "file": RAY_TRACING_FILE, "bytes": expected})
    );
}

#[test]
fn a_material_sets_the_flags() {
    let masked = json!({"alphaMode": "MASK", "doubleSided": true});
    let both = RAY_TRACING_FLAG_MASKED | RAY_TRACING_FLAG_TWO_SIDED;
    assert_eq!(material_flags(Some(&masked), false), both);
    assert_eq!(material_flags(None, true), RAY_TRACING_FLAG_TRANSLUCENT);
    assert_eq!(material_flags(Some(&json!({})), false), 0);
}
