//! Iterative graph validation avoids recursion on untrusted node chains.
use super::*;
pub(in super::super) fn emit(
    doc: &Document,
    meshes: &[Option<usize>],
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<()> {
    let mut roots = Vec::new();
    if doc.nodes.is_empty() {
        for (index, mesh) in meshes.iter().enumerate() {
            if let Some(mesh) = mesh {
                roots.push(scene.node(json!({"name":format!("model-{index}"),"mesh":mesh})));
            }
        }
    } else {
        let mut parents = BTreeMap::new();
        for node in doc.nodes.values() {
            for child in node.children() {
                if !doc.nodes.contains_key(child) || parents.insert(*child, ()).is_some() {
                    return Err(source::invalid("vox", "missing or multiply parented node"));
                }
            }
        }
        let mut stack: Vec<_> = doc
            .nodes
            .keys()
            .filter(|id| !parents.contains_key(id))
            .copied()
            .collect();
        let root_ids = stack.clone();
        let mut visited = 0;
        while let Some(id) = stack.pop() {
            if super::super::super::cancel::stopped(request.cancelled, visited) {
                return Err(super::super::super::cancel::refusal());
            }
            visited += 1;
            stack.extend(doc.nodes[&id].children());
        }
        if visited != doc.nodes.len() {
            return Err(source::invalid("vox", "cyclic graph"));
        }
        let first = scene.nodes.len();
        let ranks: BTreeMap<_, _> = doc
            .nodes
            .keys()
            .enumerate()
            .map(|(rank, id)| (*id, first + rank))
            .collect();
        for (id, node) in &doc.nodes {
            let mut value = json!({"name":node.attrs.get("_name").cloned().unwrap_or_else(||format!("node-{id}")),"extras":{"voxNode":id}});
            let mut hidden = node.attrs.get("_hidden").is_some_and(|v| v == "1");
            match &node.kind {
                Kind::Transform { layer, frame, .. } => {
                    value["matrix"] = json!(matrix(frame)?);
                    hidden |= doc
                        .layers
                        .get(layer)
                        .and_then(|l| l.get("_hidden"))
                        .is_some_and(|v| v == "1");
                }
                Kind::Shape(model) => {
                    let mesh = meshes
                        .get(*model)
                        .ok_or_else(|| source::invalid("vox", "shape model index out of range"))?;
                    if let Some(mesh) = mesh {
                        value["mesh"] = json!(mesh);
                    }
                }
                Kind::Group(_) => {}
            }
            if hidden {
                value["extensions"] = json!({"KHR_node_visibility":{"visible":false}});
            }
            if !node.children().is_empty() {
                value["children"] =
                    json!(node.children().iter().map(|c| ranks[c]).collect::<Vec<_>>());
            }
            scene.node(value);
        }
        roots.extend(root_ids.iter().map(|id| ranks[id]));
    }
    // Right-handed VOX Z-up → right-handed glTF Y-up, one voxel = one world unit.
    scene.node(json!({"name":"VOX","matrix":[1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1],"children":roots}));
    Ok(())
}
