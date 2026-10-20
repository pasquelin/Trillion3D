//! THE PROXY BVH, built 4-wide directly: every node splits its triangles by two levels of the median
//! split of every tree over boxed things (`split::bisect_least_cost`), into two to four children,
//! down to leaves of `PROXY_LEAF_TRIANGLES`. Nodes are numbered in preorder, each with the rank
//! past its subtree: the GPU's quantized wide records (`wide::encode`) and the CPU tracer's
//! stackless skip list (`flatten`) are two writings of this one tree.
use super::{PROXY_CHILDREN, PROXY_LEAF_TRIANGLES, PROXY_TRIANGLE_FLOATS};
use crate::split::{bisect_least_cost, centres_and_boxes, Boxed};
use trillion3d_math::aabb::aabb_of_f32;

/// A node: its bounds, and either a triangle range (a leaf) or its two to four children's ranks,
/// held in place; `escape` is the rank past its subtree in preorder.
pub struct Node {
    pub low: [f32; 3],
    pub high: [f32; 3],
    pub first: usize,
    pub count: usize,
    kids: [u32; PROXY_CHILDREN],
    kid_count: u8,
    pub escape: usize,
}

impl Node {
    /// Its children's ranks in preorder, none for a leaf.
    pub fn children(&self) -> &[u32] {
        &self.kids[..usize::from(self.kid_count)]
    }
}

/// Bounds of a triangle range, read once per node.
fn bounds_of(triangles: &[f32], order: &[usize], range: (usize, usize)) -> ([f32; 3], [f32; 3]) {
    aabb_of_f32(order[range.0..range.1].iter().flat_map(|slot| {
        let base = slot * PROXY_TRIANGLE_FLOATS;
        triangles[base..base + PROXY_TRIANGLE_FLOATS]
            .as_chunks::<3>()
            .0
            .iter()
            .copied()
    }))
}

fn boxed(triangles: &[f32]) -> Boxed {
    let corners = |t: &[f32; PROXY_TRIANGLE_FLOATS]| {
        [0, 3, 6].map(|corner| [0, 1, 2].map(|axis| f64::from(t[corner + axis])))
    };
    let triangles = triangles.as_chunks::<PROXY_TRIANGLE_FLOATS>().0;
    centres_and_boxes(triangles.iter().map(corners))
}

/// The parts a node of `range` splits into: its two halves at the median on the axis of least
/// cost, each halved again the same way when it still holds more than a leaf. Balanced: depth
/// logarithmic in the triangle count, a traversal bound the engine announces before the frame;
/// coincident centroids still split into equal parts rather than looping.
fn parts(boxed: &Boxed, order: &mut [usize], range: (usize, usize)) -> Vec<(usize, usize)> {
    let (centres, boxes) = boxed;
    let halve = |order: &mut [usize], (from, to): (usize, usize)| {
        let half = (to - from) / 2;
        bisect_least_cost(&mut order[from..to], centres, |t| boxes[t], half);
        [(from, from + half), (from + half, to)]
    };
    let mut out = Vec::with_capacity(PROXY_CHILDREN);
    for part in halve(order, range) {
        if part.1 - part.0 > PROXY_LEAF_TRIANGLES {
            out.extend(halve(order, part));
        } else {
            out.push(part);
        }
    }
    out
}

/// The subtree of `range`, in preorder from `nodes.len()`; returns its root's rank.
fn split(
    triangles: &[f32],
    boxed: &Boxed,
    order: &mut [usize],
    range: (usize, usize),
    nodes: &mut Vec<Node>,
) -> usize {
    let (low, high) = bounds_of(triangles, order, range);
    let at = nodes.len();
    nodes.push(Node {
        low,
        high,
        first: range.0,
        count: range.1 - range.0,
        kids: [0; PROXY_CHILDREN],
        kid_count: 0,
        escape: 0,
    });
    if range.1 - range.0 > PROXY_LEAF_TRIANGLES {
        nodes[at].count = 0;
        for part in parts(boxed, order, range) {
            let child = split(triangles, boxed, order, part, nodes) as u32;
            let node = &mut nodes[at];
            node.kids[usize::from(node.kid_count)] = child;
            node.kid_count += 1;
        }
    }
    nodes[at].escape = nodes.len();
    at
}

/// Builds the tree and reorders triangles and albedos so each leaf names a contiguous range.
pub fn build(triangles: &mut Vec<f32>, albedo: &mut Vec<u32>) -> Vec<Node> {
    build_ordered(triangles, albedo).0
}

/// The same tree, with its original triangle ranks for parallel provenance columns.
pub fn build_ordered(triangles: &mut Vec<f32>, albedo: &mut Vec<u32>) -> (Vec<Node>, Vec<usize>) {
    let count = triangles.len() / PROXY_TRIANGLE_FLOATS;
    if count == 0 {
        return (Vec::new(), Vec::new());
    }
    let mut order: Vec<usize> = (0..count).collect();
    let mut nodes: Vec<Node> = Vec::with_capacity(count * 2 / PROXY_LEAF_TRIANGLES + 2);
    split(
        triangles,
        &boxed(triangles),
        &mut order,
        (0, count),
        &mut nodes,
    );
    permute(triangles, albedo, &order);
    (nodes, order)
}

/// Slot `i` of `triangles` and `albedo` given what slot `order[i]` held, in place, cycle by cycle:
/// no second copy of the soup.
fn permute(triangles: &mut [f32], albedo: &mut [u32], order: &[usize]) {
    let records = triangles.as_chunks_mut::<PROXY_TRIANGLE_FLOATS>().0;
    let mut placed = vec![false; order.len()];
    for start in 0..order.len() {
        if placed[start] {
            continue;
        }
        let (record, colour) = (records[start], albedo[start]);
        let mut at = start;
        loop {
            placed[at] = true;
            let from = order[at];
            if from == start {
                records[at] = record;
                albedo[at] = colour;
                break;
            }
            records[at] = records[from];
            albedo[at] = albedo[from];
            at = from;
        }
    }
}

/// World extent of proxy. Empty proxy keeps zero extent, never infinite.
pub fn extent(triangles: &[f32]) -> [f64; 6] {
    if triangles.is_empty() {
        return [0.0; 6];
    }
    let mut out = trillion3d_math::aabb::EMPTY_FLAT;
    for vertex in triangles.as_chunks::<3>().0 {
        trillion3d_math::aabb::extend_flat(&mut out, vertex.map(f64::from));
    }
    out
}

/// The tree as subtree skips, the CPU tracer's stackless walk: six bound numbers and three
/// integers per node in preorder — the rank past its subtree, first triangle, triangle count. A hit
/// node steps to the next rank, a missed one or a finished leaf to its skip.
pub fn flatten(nodes: &[Node]) -> (Vec<f32>, Vec<u32>) {
    let mut bounds = Vec::with_capacity(nodes.len() * 6);
    let mut links = Vec::with_capacity(nodes.len() * 3);
    for node in nodes {
        bounds.extend_from_slice(&node.low);
        bounds.extend_from_slice(&node.high);
        links.push(node.escape as u32);
        links.push(node.first as u32);
        links.push(node.count as u32);
    }
    (bounds, links)
}
