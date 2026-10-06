//! What the partition reads of the scene graph: the nodes an animation moves, each node's parent
//! and whether the scene reaches it.
use super::*;

/// The nodes an animation moves, and the joints and skeleton roots a skin names: their
/// pose is not the one the table declares, and a skin names them by their rank in the core.
pub(super) fn animated(g: &Value) -> BTreeSet<usize> {
    let animations = g["animations"].as_array().into_iter().flatten();
    let channels = animations.flat_map(|a| a["channels"].as_array().into_iter().flatten());
    let node = |c: &Value| Some(c.pointer("/target/node")?.as_u64()? as usize);
    let skins = g["skins"].as_array().into_iter().flatten();
    let joints = skins.flat_map(|s| {
        let named = s["joints"].as_array().into_iter().flatten();
        named.chain(s.get("skeleton")).filter_map(Value::as_u64)
    });
    channels
        .filter_map(node)
        .chain(joints.map(|j| j as usize))
        .collect()
}

/// Each node's parent, and whether the scene reaches it from `roots`.
pub(super) fn hierarchy(table: &[Value], roots: &[usize]) -> (Vec<Option<usize>>, Vec<bool>) {
    let children = |id: usize| -> Vec<usize> {
        table[id]["children"].as_array().map_or(Vec::new(), |c| {
            c.iter()
                .filter_map(|v| v.as_u64().map(|v| v as usize))
                .collect()
        })
    };
    let mut parent = vec![None; table.len()];
    for id in 0..table.len() {
        for child in children(id) {
            parent[child] = Some(id);
        }
    }
    let mut reached = vec![false; table.len()];
    let mut stack = roots.to_vec();
    while let Some(id) = stack.pop() {
        if !std::mem::replace(&mut reached[id], true) {
            stack.extend(children(id));
        }
    }
    (parent, reached)
}
