use super::*;

pub(super) struct NodeSelection {
    pub chosen: BTreeSet<usize>,
    pub selected_triangles: usize,
    pub skinned_meshes: BTreeSet<usize>,
    pub meshes: BTreeSet<usize>,
    pub mesh_map: BTreeMap<usize, usize>,
}

/// Les indices d'enfants d'un nœud, bornés au tableau des nœuds. Le seul endroit où `children` se
/// lit : la hiérarchie se parcourt deux fois — pour les matrices monde, pour la scène rendue — et
/// une seule des deux lectures a le droit d'exister.
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

/// Les racines de la scène rendue. glTF 2.0 §3.5 : un document ne rend qu'une scène — celle que
/// `scene` nomme, sinon la première déclarée. Sans `scenes`, le document n'en désigne aucune : le
/// compilateur prend alors toutes les racines de la hiérarchie, et `docs/COMPILER.md` l'écrit.
fn scene_roots(g: &Value, nodes: &[Value]) -> Result<Vec<usize>> {
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

/// Les nœuds que la scène rendue atteint depuis ses racines. Un nœud d'une autre scène, ou qu'aucune
/// scène ne nomme, n'appartient pas à ce qui est compilé : ni sa géométrie, ni sa lampe, ni son
/// remplaçant dans le proxy. Cet ensemble est le seul que la sélection, le proxy et les lampes
/// consultent, pour qu'ils ne puissent pas répondre trois choses différentes.
pub(super) fn scene_nodes(g: &Value) -> Result<BTreeSet<usize>> {
    let nodes = values(g, "nodes")?;
    let mut stack = scene_roots(g, nodes)?;
    let mut reached = BTreeSet::new();
    while let Some(id) = stack.pop() {
        if !reached.insert(id) {
            continue;
        }
        stack.extend(children_of(nodes, id)?);
    }
    Ok(reached)
}

pub(super) fn select_nodes(
    o: &Options,
    g: &Value,
    scene_nodes: &BTreeSet<usize>,
) -> Result<NodeSelection> {
    let nodes = values(g, "nodes")?;
    let mut chosen = BTreeSet::new();
    let mut selected_triangles = 0;
    let mut overflowing = Vec::new();
    let mut skinned_meshes = BTreeSet::new();
    for (i, n) in nodes.iter().enumerate() {
        if scene_nodes.contains(&i) && n.get("mesh").is_some() {
            if n.get("skin").is_some() {
                if let Ok(m) = required_index(n.get("mesh"), "node.mesh") {
                    skinned_meshes.insert(m);
                }
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
    Ok(NodeSelection {
        chosen,
        selected_triangles,
        skinned_meshes,
        meshes,
        mesh_map,
    })
}
