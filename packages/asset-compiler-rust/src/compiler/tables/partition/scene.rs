//! What the partition reads of the scene graph: the nodes a skin names, each node's parent and
//! whether the scene reaches it, and the topmost object above each node, the root of its batch.
//! The nodes an animation moves are the motion tables' reading (`../motion.rs`, `moved`).
use super::*;
use crate::compiler::source::nodes::{child_lists, parent_ranks};

/// The joints and skeleton roots the skins name: a skin names them by their rank in the core, so
/// they never leave it. They pin nothing under them: a node below a joint streams as any other,
/// its row following the joint's pose.
pub(super) fn named(g: &Value) -> BTreeSet<usize> {
    let skins = g["skins"].as_array().into_iter().flatten();
    let joints = skins.flat_map(|s| {
        let joints = s["joints"].as_array().into_iter().flatten();
        joints.chain(s.get("skeleton")).filter_map(Value::as_u64)
    });
    joints.map(|j| j as usize).collect()
}

/// Each node's parent, and whether the scene reaches it from `roots`: the node table's children
/// read once (`nodes::child_lists`).
pub(super) fn hierarchy(
    table: &[Value],
    roots: &[usize],
) -> Result<(Vec<Option<usize>>, Vec<bool>)> {
    let children = child_lists(table)?;
    let mut reached = vec![false; table.len()];
    let mut stack = roots.to_vec();
    while let Some(id) = stack.pop() {
        if !std::mem::replace(&mut reached[id], true) {
            stack.extend_from_slice(&children[id]);
        }
    }
    Ok((parent_ranks(&children), reached))
}

/// Per node of the graph `parent` gives, whether it and every node above it lies outside `moved`:
/// each node is climbed once, a climb stopping at the first node already known.
pub(super) fn still_nodes(parent: &[Option<usize>], moved: &BTreeSet<usize>) -> Vec<bool> {
    let mut known: Vec<Option<bool>> = vec![None; parent.len()];
    for id in 0..parent.len() {
        let (mut path, mut at, mut above) = (Vec::new(), Some(id), true);
        while let Some(node) = at {
            if let Some(held) = known[node] {
                above = held;
                break;
            }
            path.push(node);
            at = parent[node];
        }
        // Down the climbed path from the top: still while nothing above or at it moves.
        for &node in path.iter().rev() {
            above &= !moved.contains(&node);
            known[node] = Some(above);
        }
    }
    known.into_iter().map(|held| held == Some(true)).collect()
}

/// Per node of the graph `parent` gives, the topmost node at or above it that `object` says is an
/// object, `None` for a node under none: the root of the batch its object streams in
/// (`candidates.rs`). Each node is climbed once: a climb stops at the first node already known.
pub(super) fn batch_roots(
    parent: &[Option<usize>],
    object: impl Fn(usize) -> bool,
) -> Vec<Option<usize>> {
    let mut top: Vec<Option<Option<usize>>> = vec![None; parent.len()];
    for id in 0..parent.len() {
        let (mut path, mut at, mut above) = (Vec::new(), Some(id), None);
        while let Some(node) = at {
            if let Some(known) = top[node] {
                above = known;
                break;
            }
            path.push(node);
            at = parent[node];
        }
        // Down the climbed path, the first object met is the topmost.
        for &node in path.iter().rev() {
            if above.is_none() && object(node) {
                above = Some(node);
            }
            top[node] = Some(above);
        }
    }
    top.into_iter().map(Option::flatten).collect()
}
