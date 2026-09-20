use super::{PROXY_LEAF_TRIANGLES, PROXY_TRIANGLE_FLOATS};

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
    /// Box area, up to a factor of two: decides which child opens first
    /// when a wide node seeks to fill itself.
    pub fn area(&self) -> f32 {
        let span = [
            (self.high[0] - self.low[0]).max(0.0),
            (self.high[1] - self.low[1]).max(0.0),
            (self.high[2] - self.low[2]).max(0.0),
        ];
        span[0] * span[1] + span[1] * span[2] + span[2] * span[0]
    }
}

/// Bounds of a triangle range, read once per node.
fn bounds_of(triangles: &[f32], order: &[usize], range: (usize, usize)) -> ([f32; 3], [f32; 3]) {
    let mut low = [f32::INFINITY; 3];
    let mut high = [f32::NEG_INFINITY; 3];
    for slot in &order[range.0..range.1] {
        let base = slot * PROXY_TRIANGLE_FLOATS;
        for vertex in 0..3 {
            let at = base + vertex * 3;
            let point = [triangles[at], triangles[at + 1], triangles[at + 2]];
            crate::shared_math::extend_aabb_f32(&mut low, &mut high, point);
        }
    }
    (low, high)
}

/// Triangle centroid on an axis: what median sorts.
fn centre(triangles: &[f32], slot: usize, axis: usize) -> f32 {
    let base = slot * PROXY_TRIANGLE_FLOATS;
    (triangles[base + axis] + triangles[base + 3 + axis] + triangles[base + 6 + axis]) / 3.0
}

/// Builds tree by median on longest axis, leaf at `PROXY_LEAF_TRIANGLES`.
///
/// Median gives balanced tree, depth logarithmic in triangle count:
/// engine can announce known traversal bound before frame. A split separating
/// nothing — all centroids coincident — splits into two equal parts rather than looping.
fn split(triangles: &[f32], order: &mut [usize], range: (usize, usize), nodes: &mut Vec<Node>) {
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
    // Axis choice differs from `shared_math::longest_axis`: `max_by` keeps last axis
    // on tie where DAG's `>` keeps first, `total_cmp` ranks NaNs instead of
    // ignoring. Following split also differs — `select_nth_unstable_by` vs full sort.
    let axis = (0..3)
        .max_by(|a, b| (high[*a] - low[*a]).total_cmp(&(high[*b] - low[*b])))
        .unwrap_or(0);
    let middle = range.0 + (range.1 - range.0) / 2;
    order[range.0..range.1].select_nth_unstable_by(middle - range.0, |a, b| {
        centre(triangles, *a, axis).total_cmp(&centre(triangles, *b, axis))
    });
    nodes[at].count = 0;
    split(triangles, order, (range.0, middle), nodes);
    let right = nodes.len();
    split(triangles, order, (middle, range.1), nodes);
    nodes[at].right = right;
}

/// Builds binary tree and reorders triangles and albedos so each leaf
/// names contiguous range. `wide::collapse` extracts cache wide nodes from it.
pub fn build(triangles: &mut Vec<f32>, albedo: &mut Vec<u32>) -> Vec<Node> {
    let count = triangles.len() / PROXY_TRIANGLE_FLOATS;
    if count == 0 {
        return Vec::new();
    }
    let mut order: Vec<usize> = (0..count).collect();
    let mut nodes: Vec<Node> = Vec::with_capacity(count * 2 / PROXY_LEAF_TRIANGLES + 2);
    split(triangles, &mut order, (0, count), &mut nodes);
    let mut sorted = Vec::with_capacity(triangles.len());
    let mut colours = Vec::with_capacity(albedo.len());
    for slot in &order {
        let base = slot * PROXY_TRIANGLE_FLOATS;
        sorted.extend_from_slice(&triangles[base..base + PROXY_TRIANGLE_FLOATS]);
        colours.push(albedo[*slot]);
    }
    *triangles = sorted;
    *albedo = colours;
    nodes
}

/// World extent of proxy. Empty proxy keeps zero extent, never infinite.
pub fn extent(triangles: &[f32]) -> [f64; 6] {
    if triangles.is_empty() {
        return [0.0; 6];
    }
    let mut low = [f64::INFINITY; 3];
    let mut high = [f64::NEG_INFINITY; 3];
    for vertex in triangles.as_chunks::<3>().0 {
        let point = [vertex[0] as f64, vertex[1] as f64, vertex[2] as f64];
        crate::shared_math::extend_aabb(&mut low, &mut high, point);
    }
    [low[0], low[1], low[2], high[0], high[1], high[2]]
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
