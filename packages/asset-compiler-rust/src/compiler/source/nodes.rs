use crate::*;

/// Node `id` of `nodes`, the source mesh it places and that mesh's compiled rank in `mesh_map`;
/// `None` when the mesh was not compiled. The one walk from a shown node to its compiled mesh.
pub(crate) fn compiled_mesh<'a>(
    nodes: &'a [Value],
    id: usize,
    mesh_map: &BTreeMap<usize, usize>,
) -> Result<Option<(&'a Value, usize, usize)>> {
    let node = item(nodes, id, "node")?;
    let old_mesh = required_index(node.get("mesh"), "node.mesh")?;
    Ok(mesh_map.get(&old_mesh).map(|&mesh| (node, old_mesh, mesh)))
}

/// Child indices of a node, bounded to the node array. The only place `children`
/// is read: the hierarchy is walked twice — for world matrices, for the rendered
/// scene — and only one of the two reads is allowed to exist.
pub(crate) fn children_of(nodes: &[Value], id: usize) -> Result<Vec<usize>> {
    let mut out = Vec::new();
    for child in nodes[id]
        .get("children")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        out.push(bounded(child, "node.children", nodes.len())?);
    }
    Ok(out)
}

/// State of a node in the walk that looks for a cycle: never seen, currently
/// walking, or fully walked. Finding a node currently being walked means we have
/// come back on our steps.
#[derive(Clone, Copy, PartialEq)]
enum Visit {
    Unseen,
    Walking,
    Done,
}

/// Refuses a node hierarchy that closes on itself. World-matrix walk starts from
/// parentless nodes: a closed cycle has none, so it would never be walked and would
/// go out published as-is, sending the consumer's walk into an endless loop. Every
/// node is visited, not only those the rendered scene names, because the whole
/// document is published. A parentless node outside the scene is not a cycle: it
/// is never seen again.
pub(crate) fn check_acyclic(g: &Value) -> Result<()> {
    let nodes = values(g, "nodes")?;
    let mut state = vec![Visit::Unseen; nodes.len()];
    for start in 0..nodes.len() {
        if state[start] != Visit::Unseen {
            continue;
        }
        state[start] = Visit::Walking;
        let mut stack = vec![(start, children_of(nodes, start)?)];
        while let Some((id, rest)) = stack.last_mut() {
            let Some(child) = rest.pop() else {
                state[*id] = Visit::Done;
                stack.pop();
                continue;
            };
            match state[child] {
                Visit::Walking => return Err(invalid("node.children closes a cycle")),
                Visit::Done => {}
                Visit::Unseen => {
                    state[child] = Visit::Walking;
                    stack.push((child, children_of(nodes, child)?));
                }
            }
        }
    }
    Ok(())
}

/// Hierarchy roots: the nodes no other cites as a child, in index order. A node cited by two
/// parents is refused — a hierarchy is a forest. The one reading of roots for the compiler's scene,
/// its world matrices and every driver's tables.
pub(crate) fn hierarchy_roots(nodes: &[Value]) -> Result<Vec<usize>> {
    let mut is_child = vec![false; nodes.len()];
    for id in 0..nodes.len() {
        for child in children_of(nodes, id)? {
            if std::mem::replace(&mut is_child[child], true) {
                return Err(invalid("A node is the child of two parents"));
            }
        }
    }
    Ok((0..nodes.len()).filter(|id| !is_child[*id]).collect())
}

/// Roots of the rendered scene. glTF 2.0 §3.5: a document renders only one scene
/// — the one `scene` names, otherwise the first declared. Without `scenes`, or with an
/// empty one, the document names none: the compiler then takes every hierarchy root.
pub(crate) fn scene_roots(g: &Value, nodes: &[Value]) -> Result<Vec<usize>> {
    let Some(scenes) = g
        .get("scenes")
        .and_then(Value::as_array)
        .filter(|scenes| !scenes.is_empty())
    else {
        return hierarchy_roots(nodes);
    };
    let named = match g.get("scene") {
        Some(value) => bounded(value, "scene", scenes.len())?,
        None => 0,
    };
    let scene = &scenes[named];
    let mut roots = Vec::new();
    for entry in scene
        .get("nodes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        roots.push(bounded(entry, "scene.nodes", nodes.len())?);
    }
    Ok(roots)
}

/// Whether `node` declares itself hidden (`KHR_node_visibility` `visible: false`).
pub(crate) fn declared_hidden(node: &Value) -> bool {
    node.pointer("/extensions/KHR_node_visibility/visible") == Some(&Value::Bool(false))
}

/// Nodes the rendered scene reaches from its roots, and those a hidden node hides (itself and
/// every node under it: compiled, but no surface, proxy triangle or collider comes from them). A
/// node no scene reaches is not compiled at all. Selection, the proxy and lights read this walk.
pub(crate) fn scene_nodes(g: &Value) -> Result<(BTreeSet<usize>, BTreeSet<usize>)> {
    let nodes = values(g, "nodes")?;
    let roots = scene_roots(g, nodes)?;
    let mut stack: Vec<_> = roots.into_iter().map(|id| (id, false)).collect();
    let (mut reached, mut hidden) = (BTreeSet::new(), BTreeSet::new());
    while let Some((id, above)) = stack.pop() {
        if !reached.insert(id) {
            continue;
        }
        let under = above || declared_hidden(&nodes[id]);
        if under {
            hidden.insert(id);
        }
        let children = children_of(nodes, id)?;
        stack.extend(children.into_iter().map(|child| (child, under)));
    }
    Ok((reached, hidden))
}
