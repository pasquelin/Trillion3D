//! The file holds a head, the records, the nodes, each corner once and the triangles naming them;
//! a material sets the flags.
use super::cluster;
use crate::ray_tracing::abi::*;
use crate::ray_tracing::encode::{encode, report};
use crate::ray_tracing::tree::{material_flags, primitive_tree, PrimitiveTree, Traced};
use crate::support::le::u32_at;
use serde_json::json;

#[test]
fn the_file_holds_a_head_the_records_the_nodes_the_vertices_and_the_triangles() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0];
    let dag = [cluster(vec![0, 1, 2, 0, 2, 3], (0.0, f64::INFINITY), false)];
    let traced = Traced {
        mesh: 3,
        primitive: 4,
        flags: RAY_TRACING_FLAG_MASKED,
        cell: 0,
    };
    let tree = primitive_tree(&positions, &[], &dag, traced)
        .expect("a tree")
        .expect("two triangles");
    assert_eq!(tree.node_count(), 1);
    assert_eq!(tree.triangle_count(), 2);
    let flat = tree.triangles.clone();
    let trees = [None, Some(tree), None];
    let held: Vec<&PrimitiveTree> = trees.iter().flatten().collect();
    let bytes = encode(&held).expect("a file");
    // The two triangles of the square share two of their corners: four vertices.
    let vertices_at = RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_BYTES + RAY_TRACING_NODE_BYTES;
    let triangles_at = vertices_at + 4 * RAY_TRACING_VERTEX_BYTES;
    let expected = triangles_at + 2 * RAY_TRACING_INDEXED_TRIANGLE_BYTES;
    assert_eq!(bytes.len(), expected);
    let word = |at: usize| u32_at(&bytes, at).unwrap();
    assert_eq!(&bytes[..4], b"T3RT");
    assert_eq!(
        [word(4), word(8), word(12), word(16), word(20)],
        [RAY_TRACING_VERSION, 1, 1, 2, 4]
    );
    // Each triangle's corners, read back from the distances it holds — zero for the next vertex —,
    // then its last words: the tree's bytes, every vertex named.
    let (mut next, mut unfolded) = (0, Vec::new());
    for triangle in bytes[triangles_at..]
        .as_chunks::<RAY_TRACING_INDEXED_TRIANGLE_BYTES>()
        .0
    {
        for c in 0..3 {
            let back = u32_at(triangle, 4 * c).unwrap() as usize;
            let v = if back == 0 {
                next += 1;
                next - 1
            } else {
                next - back
            };
            unfolded.extend_from_slice(
                &bytes[vertices_at + v * RAY_TRACING_VERTEX_BYTES..][..RAY_TRACING_VERTEX_BYTES],
            );
        }
        unfolded.extend_from_slice(&triangle[12..]);
    }
    assert_eq!(next, 4);
    assert_eq!(unfolded, flat);
    assert_eq!(flat.len(), 2 * RAY_TRACING_TRIANGLE_BYTES);
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

/// The flags each record of the file of the primitives `named` (mesh, primitive, flags), one
/// triangle each, is written with.
fn written(named: &[(u32, u32, u32)]) -> Vec<u32> {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let dag = [cluster(vec![0, 1, 2], (0.0, f64::INFINITY), false)];
    let trees: Vec<PrimitiveTree> = (named.iter())
        .map(|&(mesh, primitive, flags)| {
            let traced = Traced {
                mesh,
                primitive,
                flags,
                cell: 0,
            };
            primitive_tree(&positions, &[], &dag, traced)
                .expect("a tree")
                .expect("a triangle")
        })
        .collect();
    let bytes = encode(&trees.iter().collect::<Vec<_>>()).expect("a file");
    (0..named.len())
        .map(|k| RAY_TRACING_HEAD_BYTES + k * RAY_TRACING_RECORD_BYTES + 8)
        .map(|at| u32_at(&bytes, at).unwrap())
        .collect()
}

#[test]
fn a_mesh_of_translucent_primitives_alone_is_flagged_whole() {
    let translucent = RAY_TRACING_FLAG_TRANSLUCENT;
    let whole = translucent | RAY_TRACING_FLAG_ALL_TRANSLUCENT;
    // Every primitive of mesh 1 is translucent: each is flagged, whatever its other flags.
    let two_sided = translucent | RAY_TRACING_FLAG_TWO_SIDED;
    assert_eq!(
        written(&[(1, 0, translucent), (1, 1, two_sided)]),
        [whole, two_sided | RAY_TRACING_FLAG_ALL_TRANSLUCENT]
    );
    // Mesh 2 has an opaque primitive: none of its records is flagged, its translucent one only
    // translucent; mesh 3, alone and translucent, is whole beside it.
    assert_eq!(
        written(&[(2, 0, translucent), (2, 1, 0), (3, 0, translucent)]),
        [translucent, 0, whole]
    );
    // An opaque primitive is never flagged.
    assert_eq!(
        written(&[(4, 0, RAY_TRACING_FLAG_MASKED)]),
        [RAY_TRACING_FLAG_MASKED]
    );
}
