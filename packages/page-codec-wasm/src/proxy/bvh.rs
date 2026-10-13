use super::{PROXY_LEAF_TRIANGLES, PROXY_TRIANGLE_FLOATS};
use crate::split::bisect_centres;
use trillion3d_math::aabb::{aabb_of_f32, half_area};
use trillion3d_math::scalar::mean;

/// A binary node being built: its bounds, and either a triangle range or its
/// right child — left child is always next node.
pub struct Node {
    pub low: [f32; 3],
    pub high: [f32; 3],
    pub first: usize,
    pub count: usize,
    pub right: usize,
}
impl Node {
    pub fn leaf(&self) -> bool {
        self.count > 0
    }
    /// Box area, up to a factor of two (`half_area`): decides which child opens first
    /// when a wide node seeks to fill itself.
    pub fn area(&self) -> f32 {
        half_area(self.low, self.high)
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

/// Triangle centroids, the `mean` of the three corners axis by axis: what the median splits.
fn centres(triangles: &[f32]) -> Vec<[f64; 3]> {
    let centre = |t: &[f32; PROXY_TRIANGLE_FLOATS]| {
        [0, 1, 2].map(|axis| mean([0, 3, 6].map(|corner| f64::from(t[corner + axis]))))
    };
    (triangles.as_chunks::<PROXY_TRIANGLE_FLOATS>().0.iter())
        .map(centre)
        .collect()
}

/// Builds tree by the median split of every tree over boxed things (`split::bisect_centres`: the
/// widest axis of the centroids, ties by rank), leaf at `PROXY_LEAF_TRIANGLES`.
///
/// Median gives balanced tree, depth logarithmic in triangle count:
/// engine can announce known traversal bound before frame. A split separating
/// nothing — all centroids coincident — splits into two equal parts rather than looping.
fn split(
    triangles: &[f32],
    centres: &[[f64; 3]],
    order: &mut [usize],
    range: (usize, usize),
    nodes: &mut Vec<Node>,
) {
    let (low, high) = bounds_of(triangles, order, range);
    let at = nodes.len();
    nodes.push(Node {
        low,
        high,
        first: range.0,
        count: range.1 - range.0,
        right: 0,
    });
    if range.1 - range.0 <= PROXY_LEAF_TRIANGLES {
        return;
    }
    bisect_centres(&mut order[range.0..range.1], centres);
    let middle = range.0 + (range.1 - range.0) / 2;
    nodes[at].count = 0;
    split(triangles, centres, order, (range.0, middle), nodes);
    let right = nodes.len();
    split(triangles, centres, order, (middle, range.1), nodes);
    nodes[at].right = right;
}

/// Builds binary tree and reorders triangles and albedos so each leaf
/// names contiguous range. `wide::collapse` extracts cache wide nodes from it.
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
        &centres(triangles),
        &mut order,
        (0, count),
        &mut nodes,
    );
    let mut sorted = Vec::with_capacity(triangles.len());
    let mut colours = Vec::with_capacity(albedo.len());
    for slot in &order {
        let base = slot * PROXY_TRIANGLE_FLOATS;
        sorted.extend_from_slice(&triangles[base..base + PROXY_TRIANGLE_FLOATS]);
        colours.push(albedo[*slot]);
    }
    *triangles = sorted;
    *albedo = colours;
    (nodes, order)
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

/// Binary tree flattened into subtree skips: six bound numbers and three integers per
/// node — skip, first triangle, triangle count. Used for CPU oracle traces,
/// where stackless traversal beats wide nodes; proxy cache itself carries the wide form from `wide::collapse`.
pub fn flatten(nodes: &[Node]) -> (Vec<f32>, Vec<u32>) {
    let mut escape = vec![0u32; nodes.len()];
    for at in (0..nodes.len()).rev() {
        escape[at] = if nodes[at].leaf() {
            at as u32 + 1
        } else {
            escape[nodes[at].right]
        };
    }
    let mut bounds = Vec::with_capacity(nodes.len() * 6);
    let mut links = Vec::with_capacity(nodes.len() * 3);
    for (at, node) in nodes.iter().enumerate() {
        bounds.extend_from_slice(&node.low);
        bounds.extend_from_slice(&node.high);
        links.push(escape[at]);
        links.push(node.first as u32);
        links.push(node.count as u32);
    }
    (bounds, links)
}
