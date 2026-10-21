//! A skin's frame — the node its joints are posed relative to — and the nodes from it down to each
//! joint. The frame of a skin is the parent of its top joints, the joints whose parent is no joint
//! of the skin; the lowest common ancestor of those parents when they differ; the scene's root —
//! none — when a top joint is a root itself, or when the parents lie in two trees. It is never a
//! joint: the highest joint above any joint is a top one, whose parent the frame lies at or above.
//!
//! glTF ignores a skinned node's own pose — its vertex is `world(joint) · inverseBind · v` —, and
//! `world(joint) = world(frame) · M`, `M` the product of the local poses from the frame down to the
//! joint: a bank stores each joint's `M` (`bank.rs`), and an instance is placed at its frame's
//! world.
use super::*;

/// `node` and every node above it, nearest first.
fn upward(parents: &[Option<usize>], node: usize) -> impl Iterator<Item = usize> + '_ {
    std::iter::successors(Some(node), |&at| parents[at])
}

/// The lowest node `a` and `b` both lie at or under, none when they lie in two trees.
fn lowest_common(parents: &[Option<usize>], a: usize, b: usize) -> Option<usize> {
    let above: BTreeSet<usize> = upward(parents, a).collect();
    upward(parents, b).find(|node| above.contains(node))
}

/// The frame of the skin whose joints are `joints`, as the module defines it.
fn frame_of(parents: &[Option<usize>], joints: &[usize]) -> Option<usize> {
    let joint: BTreeSet<usize> = joints.iter().copied().collect();
    let mut tops = (joints.iter())
        .map(|&j| parents[j])
        .filter(|parent| !parent.is_some_and(|p| joint.contains(&p)));
    // A skin of no joint, or a top joint at the root, is framed by the scene's root.
    let first = tops.next()??;
    tops.try_fold(first, |frame, parent| {
        lowest_common(parents, frame, parent?)
    })
}

/// The nodes a skin's joints are posed through: its frame; the nodes from the frame (exclusive)
/// down to each joint, parents first, each with its parent's place among them — none for a child
/// of the frame —; and each joint's place, in the skin's joint order.
pub(super) struct Chain {
    pub frame: Option<usize>,
    pub nodes: Vec<(usize, Option<usize>)>,
    pub joints: Vec<usize>,
}

impl Chain {
    /// The chain of the skin whose joints are `joints`, under `parents`.
    pub(super) fn of(parents: &[Option<usize>], joints: &[usize]) -> Self {
        let frame = frame_of(parents, joints);
        let mut place = BTreeMap::<usize, usize>::new();
        let mut nodes = Vec::new();
        let joints = (joints.iter())
            .map(|&joint| {
                let path: Vec<usize> = upward(parents, joint)
                    .take_while(|&node| Some(node) != frame)
                    .collect();
                for &node in path.iter().rev() {
                    if !place.contains_key(&node) {
                        let parent = parents[node].and_then(|p| place.get(&p).copied());
                        place.insert(node, nodes.len());
                        nodes.push((node, parent));
                    }
                }
                place[&joint]
            })
            .collect();
        Self {
            frame,
            nodes,
            joints,
        }
    }
}
