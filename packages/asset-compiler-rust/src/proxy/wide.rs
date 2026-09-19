//! From binary BVH to wide BVH: four children per node, 8-bit quantized boxes.
//!
//! Binary tree descends ray one step per node visited: on city proxy,
//! traversal bound exhausts before leaf, ray gives up. Four-child node
//! tests four boxes at once, keeps closest for next step, stacks others,
//! so same bound covers four times more tree and first hit triangle
//! prunes almost all remaining.
//!
//! Child boxes written in 8 bits in parent bounds, rounded outwards:
//! quantized box always contains what it contained, no triangle
//! disappears from ray. Wide node weighs 18 words for 4 children where
//! 4 binary nodes weighed 36.
use super::bvh::Node;
use super::{PROXY_CHILDREN, PROXY_CHILD_WORDS, PROXY_NODE_FLOATS};

/// What wide node retains of child: box, and next read offset.
struct Child {
    low: [f32; 3],
    high: [f32; 3],
    /// Child wide node index, or first triangle of leaf.
    offset: u32,
    /// Leaf triangles; zero for internal node.
    count: u32,
}

/// Four children of binary node, opened to four: at each step, internal child
/// with largest box yields to its two children. Choice making
/// tree shortest where surface area to sort is largest.
fn gather(nodes: &[Node], at: usize) -> Vec<usize> {
    if nodes[at].leaf() {
        return vec![at];
    }
    let mut kids = Vec::with_capacity(PROXY_CHILDREN);
    kids.extend([at + 1, nodes[at].right]);
    while kids.len() < PROXY_CHILDREN {
        let pick = kids
            .iter()
            .enumerate()
            .filter(|(_, index)| !nodes[**index].leaf())
            .max_by(|a, b| nodes[*a.1].area().total_cmp(&nodes[*b.1].area()))
            .map(|(slot, _)| slot);
        let Some(slot) = pick else { break };
        let parent = kids[slot];
        kids[slot] = parent + 1;
        kids.push(nodes[parent].right);
    }
    kids
}

/// Writes wide node and recursively internal children. Returns index.
fn emit(nodes: &[Node], at: usize, bounds: &mut Vec<f32>, children: &mut Vec<u32>) -> u32 {
    let slot = bounds.len() / PROXY_NODE_FLOATS;
    bounds.extend_from_slice(&nodes[at].low);
    bounds.extend_from_slice(&nodes[at].high);
    let base = children.len();
    children.resize(base + PROXY_CHILDREN * PROXY_CHILD_WORDS, 0);
    let (low, high) = (nodes[at].low, nodes[at].high);
    // Internal child writes own node further in `children`; words at this
    // location already reserved, so each child places as soon as link known.
    for (index, kid) in gather(nodes, at).into_iter().enumerate() {
        let node = &nodes[kid];
        let (offset, count) = if node.leaf() {
            (node.first as u32, node.count as u32)
        } else {
            (emit(nodes, kid, bounds, children), 0)
        };
        let child = Child {
            low: node.low,
            high: node.high,
            offset,
            count,
        };
        let word = base + index * PROXY_CHILD_WORDS;
        children[word..word + PROXY_CHILD_WORDS].copy_from_slice(&pack(&child, low, high));
    }
    slot as u32
}

/// Child box on 8 bits per axis, rounded outwards, plus two links.
/// Top word carries triangle count and presence bit: empty slot never
/// tested, inverted box not enough to rule out — plane test sees
/// only minimums and maximums.
fn pack(child: &Child, low: [f32; 3], high: [f32; 3]) -> [u32; PROXY_CHILD_WORDS] {
    let mut quantised = [[0u32; 3]; 2];
    for axis in 0..3 {
        let span = (high[axis] - low[axis]) as f64;
        // Flat or non-comparable axis: child takes parent full width on axis,
        // conservative — wider box loses no triangles.
        if !span.is_finite() || span <= 0.0 {
            quantised[1][axis] = 255;
            continue;
        }
        let unit = |value: f32| ((value - low[axis]) as f64 / span * 255.0).clamp(0.0, 255.0);
        quantised[0][axis] = unit(child.low[axis]).floor() as u32;
        quantised[1][axis] = unit(child.high[axis]).ceil() as u32;
    }
    [
        quantised[0][0] | quantised[0][1] << 8 | quantised[0][2] << 16 | quantised[1][0] << 24,
        quantised[1][1] | quantised[1][2] << 8 | child.count << 16 | 1 << 24,
        child.offset,
    ]
}

/// Two cache node columns: node exact bounds, then four children.
pub fn collapse(nodes: &[Node]) -> (Vec<f32>, Vec<u32>) {
    if nodes.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let mut bounds = Vec::new();
    let mut children = Vec::new();
    emit(nodes, 0, &mut bounds, &mut children);
    (bounds, children)
}
