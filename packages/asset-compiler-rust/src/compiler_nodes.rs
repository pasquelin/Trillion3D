use super::*;

pub(super) struct NodeSelection {
    pub chosen: BTreeSet<usize>,
    /// The chosen nodes no hidden node hides (`scene_nodes`): what the drawn scene derives from.
    pub shown: BTreeSet<usize>,
    pub selected_triangles: usize,
    pub skinned_meshes: BTreeSet<usize>,
    pub meshes: BTreeSet<usize>,
    pub mesh_map: BTreeMap<usize, usize>,
}

/// Child indices of a node, bounded to the node array. The only place `children`
/// is read: the hierarchy is walked twice — for world matrices, for the rendered
/// scene — and only one of the two reads is allowed to exist.
pub(super) fn children_of(nodes: &[Value], id: usize) -> Result<Vec<usize>> {
    let mut out = Vec::new();
    for child in nodes[id]
        .get("children")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        let index = required_index(Some(child), "node.children")?;
        if index >= nodes.len() {
            return Err(invalid("node.children index is out of bounds"));
        }
        out.push(index);
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
/// parentless nodes: a closed cycle has none, so it was never walked and used to
/// go out published as-is, sending the consumer's walk into an endless loop. Every
/// node is visited, not only those the rendered scene names, because the whole
/// document is published. A parentless node outside the scene is not a cycle: it
/// is never seen again.
pub(super) fn check_acyclic(g: &Value) -> Result<()> {
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

/// Roots of the rendered scene. glTF 2.0 §3.5: a document renders only one scene
/// — the one `scene` names, otherwise the first declared. Without `scenes`, the
/// document names none: the compiler then takes every hierarchy root, and
/// `docs/COMPILER.md` writes it.
pub(super) fn scene_roots(g: &Value, nodes: &[Value]) -> Result<Vec<usize>> {
    let Some(scenes) = g
        .get("scenes")
        .and_then(Value::as_array)
        .filter(|scenes| !scenes.is_empty())
    else {
        let mut is_child = vec![false; nodes.len()];
        for id in 0..nodes.len() {
            for child in children_of(nodes, id)? {
                is_child[child] = true;
            }
        }
        return Ok((0..nodes.len()).filter(|id| !is_child[*id]).collect());
    };
    let named = match g.get("scene") {
        Some(value) => required_index(Some(value), "scene")?,
        None => 0,
    };
    let scene = scenes
        .get(named)
        .ok_or_else(|| invalid("scene index is out of bounds"))?;
    let mut roots = Vec::new();
    for entry in scene
        .get("nodes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        let id = required_index(Some(entry), "scene.nodes")?;
        if id >= nodes.len() {
            return Err(invalid("scene.nodes index is out of bounds"));
        }
        roots.push(id);
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

pub(super) fn select_nodes(
    o: &Options,
    g: &Value,
    (scene_nodes, hidden): (&BTreeSet<usize>, &BTreeSet<usize>),
) -> Result<NodeSelection> {
    let nodes = values(g, "nodes")?;
    let mut chosen = BTreeSet::new();
    let mut selected_triangles = 0;
    let mut overflowing = Vec::new();
    let mut skinned_meshes = BTreeSet::new();
    for (i, n) in nodes.iter().enumerate() {
        if scene_nodes.contains(&i) && n.get("mesh").is_some() {
            if let (Some(_), Ok(m)) = (n.get("skin"), required_index(n.get("mesh"), "node.mesh")) {
                skinned_meshes.insert(m);
            }
            let triangles = node_triangles(g, n)?;
            if o.scope == "full" || selected_triangles + triangles <= o.triangle_budget {
                chosen.insert(i);
                selected_triangles += triangles;
            } else {
                overflowing.push((i, triangles));
            }
        }
    }
    if chosen.is_empty() {
        overflowing.sort_by_key(|&(i, triangles)| (triangles, i));
        if let Some((i, triangles)) = overflowing.first().copied() {
            chosen.insert(i);
            selected_triangles = triangles;
        } else {
            return Err(CompilerError::new(
                "EMPTY_SLICE",
                "No complete mesh instance fits the slice budget",
            ));
        }
    }
    let mut meshes = BTreeSet::new();
    for i in &chosen {
        meshes.insert(required_index(nodes[*i].get("mesh"), "node.mesh")?);
    }
    let mesh_map: BTreeMap<usize, usize> = meshes
        .iter()
        .enumerate()
        .map(|(new, old)| (*old, new))
        .collect();
    let shown = chosen.difference(hidden).copied().collect();
    Ok(NodeSelection {
        chosen,
        shown,
        selected_triangles,
        skinned_meshes,
        meshes,
        mesh_map,
    })
}
