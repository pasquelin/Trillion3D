//! The nodes a job compiles when the scene it works on carries a groom.
use super::*;
use crate::hair_strands::{Carried, Description};
use crate::tests::fixtures::options;

/// A groom, carried by `node`, that holds nothing: only the node it is carried by is read.
fn groom_on(node: usize) -> Carried {
    Carried {
        node,
        description: Description::default(),
    }
}

/// The error of picking the nodes of a scene of `nodes`, the first the root of the scene, when the
/// grooms are carried by `carried`.
fn pick_refusal(nodes: Value, carried: &[usize]) -> Option<&'static str> {
    let mut g = json!({"scenes": [{"nodes": [0]}], "nodes": nodes});
    let strands: Vec<Carried> = carried.iter().map(|&node| groom_on(node)).collect();
    let o = options(std::path::PathBuf::new(), std::path::PathBuf::new());
    pick(&o, &mut g, &[], &strands)
        .err()
        .map(|error| error.code)
}

// Behaviour: a scene whose only geometry is a groom the scene shows compiles no mesh: nothing is
// chosen and no triangle selected.
#[test]
fn a_scene_that_shows_a_groom_needs_no_mesh() {
    let mut g = json!({"scenes": [{"nodes": [0]}], "nodes": [{"children": [1]}, {}]});
    let o = options(std::path::PathBuf::new(), std::path::PathBuf::new());
    let picked = pick(&o, &mut g, &[], &[groom_on(1)]).unwrap_or_else(|e| panic!("{e}"));
    assert!(picked.chosen.is_empty() && picked.meshes.is_empty());
    assert_eq!(picked.selected_triangles, 0);
    assert_eq!(picked.scene_nodes, BTreeSet::from([0, 1]));
}

// Behaviour: a scene none of whose grooms is shown — carried by a hidden node, or by one the scene
// does not reach — and that has no mesh either is refused for lack of a slice, as ever; a scene
// with no groom at all is too.
#[test]
fn a_scene_that_shows_no_groom_and_no_mesh_is_refused() {
    let hidden = json!([
        {"children": [1]},
        {"extensions": {"KHR_node_visibility": {"visible": false}}}
    ]);
    assert_eq!(pick_refusal(hidden, &[1]), Some("EMPTY_SLICE"), "hidden");
    let unreached = json!([{}, {}]);
    assert_eq!(
        pick_refusal(unreached, &[1]),
        Some("EMPTY_SLICE"),
        "unreached"
    );
    assert_eq!(
        pick_refusal(json!([{}]), &[]),
        Some("EMPTY_SLICE"),
        "no groom"
    );
}
