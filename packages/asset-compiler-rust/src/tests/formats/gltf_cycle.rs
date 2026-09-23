//! A09: a cycle in the glTF node hierarchy. World-matrix walk used to start from
//! parentless nodes only; a closed cycle has none, so it was never walked — and
//! the scene went out published, cycle intact, ready to send the consumer's walk
//! into an endless loop. An orphan node remains a correct scene: it has a parent
//! nowhere, not a parent in a loop.
use super::*;

/// Compiles the fixture whose nodes are those of the case, and returns the
/// refusal code, or `None` when compilation succeeds.
fn refusal(tag: &str, gltf_nodes: Value, scenes: Option<Value>) -> Option<String> {
    let (root, options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["nodes"] = gltf_nodes;
    if let Some(scenes) = scenes {
        gltf["scenes"] = scenes;
    }
    write_gltf(&options, &gltf, None);
    let outcome = compile(&options, |_| {})
        .err()
        .map(|error| format!("{tag}:{}", error.code));
    let _ = fs::remove_dir_all(&root);
    outcome
}

// Finding A09: a node that declares itself its own child, and two nodes that
// declare each other children, are impossible hierarchies. They are refused
// before publication, by the same code as any other contradiction of the document.
#[test]
fn a_node_cycle_is_refused_before_publication() {
    assert_eq!(
        refusal("auto", json!([{"mesh":0,"children":[0]},{"mesh":0}]), None),
        Some("auto:INVALID_GLTF".into()),
        "a node its own child closes a cycle"
    );
    assert_eq!(
        refusal(
            "paire",
            json!([{"mesh":0,"children":[1]},{"mesh":0,"children":[0]}]),
            None
        ),
        Some("paire:INVALID_GLTF".into()),
        "two nodes children of each other close a cycle"
    );
    // The cycle is refused even when the rendered scene does not name it: what is
    // published carries the whole hierarchy, not only what the scene reaches.
    assert_eq!(
        refusal(
            "hors-scene",
            json!([{"mesh":0},{"mesh":0,"children":[2]},{"mesh":0,"children":[1]}]),
            Some(json!([{"nodes":[0]}]))
        ),
        Some("hors-scene:INVALID_GLTF".into()),
        "a cycle no scene reaches remains a cycle"
    );
}

// The other end: a parentless node no scene names is not a cycle. It is ignored,
// as it always was, and the scene compiles.
#[test]
fn an_orphan_node_stays_accepted() {
    assert_eq!(
        refusal(
            "orphelin",
            json!([{"mesh":0},{"mesh":0}]),
            Some(json!([{"nodes":[0]}]))
        ),
        None,
        "a node outside the rendered scene is not an impossible hierarchy"
    );
}
