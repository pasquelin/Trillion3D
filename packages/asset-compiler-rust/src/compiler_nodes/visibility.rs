//! `KHR_node_visibility`: a node declaring `visible: false` hides itself and every node under it.
//! Its meshes are compiled all the same, to be shown later, and the node table says it hidden;
//! nothing the compiler derives from the drawn scene — coplanar surfaces, the proxy, the oracle's
//! world, colliders — comes from a hidden node.
use super::*;

/// Whether `node` declares itself hidden.
pub(crate) fn declared_hidden(node: &Value) -> bool {
    node.pointer("/extensions/KHR_node_visibility/visible") == Some(&Value::Bool(false))
}

/// Every node of the rendered scene a hidden node hides: itself and the nodes under it.
pub(crate) fn hidden_nodes(g: &Value) -> Result<BTreeSet<usize>> {
    let nodes = values(g, "nodes")?;
    let roots = scene_roots(g, nodes)?;
    let mut stack: Vec<(usize, bool)> = roots.into_iter().map(|id| (id, false)).collect();
    let (mut reached, mut hidden) = (BTreeSet::new(), BTreeSet::new());
    while let Some((id, above)) = stack.pop() {
        if !reached.insert(id) {
            continue;
        }
        let under = above || declared_hidden(&nodes[id]);
        if under {
            hidden.insert(id);
        }
        stack.extend(
            children_of(nodes, id)?
                .into_iter()
                .map(|child| (child, under)),
        );
    }
    Ok(hidden)
}
