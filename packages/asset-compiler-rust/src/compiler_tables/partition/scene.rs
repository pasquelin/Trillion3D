//! What the partition reads of the scene graph: the nodes an animation moves, each node's parent
//! and whether the scene reaches it.
use super::*;

/// The nodes an animation moves: their pose is not the one the table declares.
pub(super) fn animated(g: &Value) -> BTreeSet<usize> {
    let animations = g["animations"].as_array().into_iter().flatten();
    let channels = animations.flat_map(|a| a["channels"].as_array().into_iter().flatten());
    let node = |c: &Value| Some(c.pointer("/target/node")?.as_u64()? as usize);
    channels.filter_map(node).collect()
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
