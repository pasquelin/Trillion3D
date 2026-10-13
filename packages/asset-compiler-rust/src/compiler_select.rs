use super::*;

pub(super) struct NodeSelection {
    pub chosen: BTreeSet<usize>,
    pub selected_triangles: usize,
    pub skinned_meshes: BTreeSet<usize>,
    pub meshes: BTreeSet<usize>,
    pub mesh_map: BTreeMap<usize, usize>,
}

/// Triangles of the meshes the chosen nodes place, each mesh once: what the proxies of a scene weigh together,
/// a mesh being one proxy whatever the nodes that place it.
pub(super) fn unique_triangles(g: &Value, chosen: &BTreeSet<usize>) -> Result<usize> {
    let nodes = values(g, "nodes")?;
    let mut seen = BTreeSet::new();
    let mut total = 0usize;
    for id in chosen {
        let node = &nodes[*id];
        let mesh = required_index(node.get("mesh"), "node.mesh")?;
        if seen.insert(mesh) {
            total += node_triangles(g, node)?;
        }
    }
    Ok(total)
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
