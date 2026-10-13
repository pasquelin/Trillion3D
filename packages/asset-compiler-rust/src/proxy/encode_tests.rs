use crate::proxy::{
    stage_proxy, ProxyInputs, SceneProxy, SCENE_PROXY_HEADER_WORDS, SCENE_PROXY_MAGIC,
    SCENE_PROXY_VERSION,
};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use trillion3d_page_codec::proxy::{
    columns_of, PROXY_NODE_FLOATS, PROXY_NODE_WORDS, PROXY_TRIANGLE_FLOATS,
};

/// A right triangle of half a metre's legs, three vertices of nine floats.
pub(crate) fn plate() -> Vec<f32> {
    vec![0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.5]
}

fn words(bytes: &[u8]) -> Vec<u32> {
    bytes
        .chunks(4)
        .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]))
        .collect()
}

/// Three nodes in a line: a parent carrying the mesh 1 twice-over (nodes 1 and 3) and the mesh 0 once.
fn staged() -> SceneProxy {
    let g = json!({"nodes": [
        {"children": [1, 2, 3]},
        {"mesh": 2, "translation": [10.0, 0.0, 0.0]},
        {"mesh": 0},
        {"mesh": 2, "translation": [0.0, 0.0, 30.0]},
    ]});
    let primitives = [json!({"mesh": 0}), json!({"mesh": 1}), json!({"mesh": 1})];
    stage_proxy(&ProxyInputs {
        g: &g,
        shown: &BTreeSet::from([1, 2, 3]),
        mesh_map: &BTreeMap::from([(0, 0), (2, 1)]),
        primitives: &primitives,
        cuts: &[plate(), plate(), Vec::new()],
        thresholds: &[0.05, 0.05, 0.05],
        previews: &[],
    })
    .expect("proxy")
}

/// A mesh placed twice is one proxy: the table has one entry a compiled primitive, and the unplaced and
/// the empty hold nothing.
#[test]
fn a_mesh_placed_twice_is_built_once_in_its_own_space() {
    let proxy = staged();
    assert_eq!(proxy.meshes.len(), 3);
    assert_eq!(
        proxy.triangle_count(),
        2,
        "one triangle for each of the two placed primitives"
    );
    assert!(
        proxy.meshes[2].triangles.is_empty(),
        "an empty cut holds none"
    );
    // The mesh in its own space: the nodes' root bounds are the plate's.
    assert_eq!(
        &proxy.meshes[1].node_bounds[..6],
        &[0.0, 0.0, 0.0, 0.5, 0.0, 0.5]
    );
    // The world extent is the placements': mesh 1 at x = 10 and at z = 30, mesh 0 at the origin.
    assert_eq!(proxy.bounds, [0.0, 0.0, 0.0, 10.5, 0.0, 30.5]);
}

/// The bytes are the header, the table, then the columns the table counts.
#[test]
fn the_file_is_the_header_the_table_and_the_columns_it_counts() {
    let proxy = staged();
    let w = words(&proxy.encode());
    assert_eq!(w[0], SCENE_PROXY_MAGIC);
    assert_eq!(w[1], SCENE_PROXY_VERSION);
    assert_eq!(w[2] as usize, proxy.meshes.len());
    assert_eq!(w[3] as usize, proxy.triangle_count());
    assert_eq!(w[4] as usize, proxy.node_count());
    let table = SCENE_PROXY_HEADER_WORDS;
    let (triangles, nodes) = (proxy.triangle_count(), proxy.node_count());
    let expected = table
        + proxy.meshes.len() * 3
        + triangles * PROXY_TRIANGLE_FLOATS
        + triangles
        + nodes * PROXY_NODE_FLOATS
        + nodes * PROXY_NODE_WORDS;
    assert_eq!(w.len(), expected);
    for (k, mesh) in proxy.meshes.iter().enumerate() {
        assert_eq!(
            w[table + 3 * k] as usize,
            mesh.triangles.len() / PROXY_TRIANGLE_FLOATS
        );
        assert_eq!(
            w[table + 3 * k + 1] as usize,
            mesh.node_children.len() / PROXY_NODE_WORDS
        );
    }
}

/// No placed mesh: the header and an empty table.
#[test]
fn a_scene_that_places_nothing_writes_the_header_alone() {
    let proxy = SceneProxy::default();
    let bytes = proxy.encode();
    assert_eq!(bytes.len(), SCENE_PROXY_HEADER_WORDS * 4);
    let w = words(&bytes);
    assert_eq!((w[2], w[3], w[4]), (0, 0, 0));
}

/// The grid step a mesh was snapped to is the builder's, in the mesh's own units.
#[test]
fn the_cell_is_the_builders() {
    let built = columns_of(plate(), 0xffff_ffff);
    let proxy = staged();
    assert_eq!(proxy.meshes[0].cell, built.cell);
}
