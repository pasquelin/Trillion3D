//! What the core keeps — the table the runtime reads before its first frame — once the cells are
//! cut: every node but those a cell places in its stead, renumbered in order — a node a cell draws
//! under its own core node stays, for the nodes under it or as its row's animation source
//! (`Row::kept`) — (`core_ranks`, `core_nodes`); and each instanced skinned object the core keeps,
//! hung under its skin's frame (`hang_banks`).
use super::candidates::{Candidate, Row};
use super::*;

/// Each node's rank in the core of `count` nodes, `None` for one a cell places in its stead: every
/// node but those `drawn` places, one the core keeps for its row (`Row::kept`) kept.
pub(super) fn core_ranks(count: usize, drawn: &BTreeMap<usize, &Candidate>) -> Vec<Option<usize>> {
    let mut rank = vec![None; count];
    let mut kept = 0usize;
    for (id, slot) in rank.iter_mut().enumerate() {
        if drawn.get(&id).is_none_or(|c| c.row.kept()) {
            *slot = Some(kept);
            kept += 1;
        }
    }
    rank
}

/// The core's nodes: each node of `table` its `rank` keeps, its children renumbered, and the mesh
/// off each a cell draws under it at no pose (`Row::Own`): its cell draws that mesh, its node a
/// frame of the nodes under it, saying so (`"meshStreams"`) — its collider streams with that cell.
pub(super) fn core_nodes(
    table: &[Value],
    rank: &[Option<usize>],
    drawn: &BTreeMap<usize, &Candidate>,
) -> Vec<Value> {
    let renumber = |ids: &[Value]| -> Vec<usize> {
        ids.iter()
            .filter_map(|v| rank[v.as_u64()? as usize])
            .collect()
    };
    (table.iter().enumerate())
        .filter(|(id, _)| rank[*id].is_some())
        .map(|(id, node)| {
            let mut node = node.clone();
            node["children"] = json!(renumber(
                node["children"].as_array().map_or(&[][..], Vec::as_slice)
            ));
            if drawn.get(&id).is_some_and(|c| matches!(c.row, Row::Own)) {
                node["mesh"] = Value::Null;
                node["meshStreams"] = json!(true);
            }
            node
        })
        .collect()
}

/// Hangs each instanced skinned object the core keeps — its node, the item its mesh plays and its
/// skin's frame (`kept`) — under that frame, among the scene's roots when the skin has none: out of
/// the children of its parent (`parent`) or of the roots, into the frame's, at no pose — its
/// `matrix`, `translation`, `rotation` and `scale` cleared —, naming its item (`"bank"`). glTF
/// ignores a skinned node's own transform, so nothing drawn moves: its item's track plays at its
/// frame's world, as a cell's row of it would (`Row::Track`).
pub(super) fn hang_banks(
    table: &mut [Value],
    roots: &mut Vec<usize>,
    parent: &[Option<usize>],
    kept: &[(usize, usize, Option<usize>)],
) {
    for &(node, item, frame) in kept {
        if parent[node] != frame {
            let rank = json!(node);
            match parent[node] {
                Some(above) => (table[above]["children"].as_array_mut())
                    .into_iter()
                    .for_each(|children| children.retain(|child| *child != rank)),
                None => roots.retain(|&root| root != node),
            }
            match frame {
                Some(frame) => (table[frame]["children"].as_array_mut())
                    .into_iter()
                    .for_each(|children| children.push(rank.clone())),
                None => roots.push(node),
            }
        }
        for field in ["matrix", "translation", "rotation", "scale"] {
            table[node][field] = Value::Null;
        }
        table[node]["bank"] = json!(item);
    }
}
