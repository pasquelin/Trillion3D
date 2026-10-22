//! The hierarchy a triangle is searched as (`search.rs`): sub-triangles, each a quarter of its
//! parent, a heap of them by the greatest bound, the barycentric weights and the area of one, and
//! the sample points of the Hammersley sequence.
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{add, dot, scale, squared_length, sub};

/// A sub-triangle of the hierarchy: the least and the most error its displacement may carry, its
/// place in its level (`x`, `y`, and whether it is one of the flipped triangles between the
/// upright ones), and its level.
#[derive(Clone, Copy, Debug)]
pub(super) struct Node {
    pub(super) error_min: f32,
    pub(super) error_max: f32,
    pub(super) x: u32,
    pub(super) y: u32,
    pub(super) flipped: bool,
    pub(super) level: u32,
}

/// Whether `a` is searched before `b`: the greater bound first.
fn precedes(a: &Node, b: &Node) -> bool {
    a.error_max > b.error_max
}

/// Adds `node` to the heap, whose root is the node searched next.
pub(super) fn heap_push(heap: &mut Vec<Node>, node: Node) {
    heap.push(node);
    let mut at = heap.len() - 1;
    while at > 0 {
        let parent = (at - 1) / 2;
        if !precedes(&heap[at], &heap[parent]) {
            break;
        }
        heap.swap(at, parent);
        at = parent;
    }
}

/// Takes the root off the heap, which is not empty.
pub(super) fn heap_pop(heap: &mut Vec<Node>) -> Node {
    let root = heap.swap_remove(0);
    let count = heap.len();
    let mut at = 0;
    while at * 2 + 1 < count {
        let (left, right) = (at * 2 + 1, at * 2 + 2);
        let mut child = left;
        if right < count && !precedes(&heap[left], &heap[right]) {
            child = right;
        }
        if !precedes(&heap[child], &heap[at]) {
            break;
        }
        heap.swap(at, child);
        at = child;
    }
    root
}

/// The barycentric weights of the corners of the sub-triangle at `(x, y)` of a level of
/// `subdivisions` rows, upright or `flipped`.
pub(super) fn sub_barycentrics(x: u32, y: u32, flipped: bool, subdivisions: u32) -> [[f32; 3]; 3] {
    let flip = i32::from(flipped);
    let (x, y, rows) = (x as i32, y as i32, subdivisions as i32);
    let corners = [[x, y + flip], [x + flip, y + 1], [x + 1, y]];
    corners.map(|[u, v]| [u as f32, v as f32, (rows - u - v) as f32].map(|b| b / rows as f32))
}

/// The area of the sub-triangle of weights `b` in a triangle of area `area`.
pub(super) fn sub_area(b: &[[f32; 3]; 3], area: f32) -> f32 {
    area * dot(b[0], cross(b[1], b[2])).abs()
}

/// The distance from the point of barycentric weight `weight` on the corner opposite an edge to the
/// edge, of length `length`, in a triangle of area `area`.
pub(super) fn distance_to_edge(weight: f32, length: f32, area: f32) -> f32 {
    2.0 * weight * area / length
}

/// The index of the least of three, the first of equals.
pub(super) fn least_of(d: [f32; 3]) -> usize {
    if d[0] < d[1] {
        if d[0] < d[2] {
            0
        } else {
            2
        }
    } else if d[1] < d[2] {
        1
    } else {
        2
    }
}

/// The point `i` of `samples` of the sequence, in a triangle's barycentric weights.
pub(super) fn hammersley(i: i32, samples: i32) -> [f32; 3] {
    let mut reverse = ((i + 1) as u32).reverse_bits();
    reverse ^= reverse >> 1;
    let mut x = (i + 1) as f32 / (samples + 1) as f32;
    let mut y = (reverse >> 8) as f32 * (1.0 / 16_777_216.0);
    if x < y {
        x *= 0.5;
        y -= x;
    } else {
        y *= 0.5;
        x -= y;
    }
    [x, y, 1.0 - x - y]
}

/// The squared distance of the displacement `at` the weights `split` from what the corners'
/// `displacements` interpolate there.
pub(super) fn stray(at: &[f32; 3], split: &[f32; 3], displacements: &[[f32; 3]; 3]) -> f32 {
    let mut lerped = scale(displacements[0], split[0]);
    for k in 1..3 {
        lerped = add(lerped, scale(displacements[k], split[k]));
    }
    squared_length(sub(*at, lerped))
}

/// The node of the hierarchy that is child `index`, of four, of `node`.
pub(super) fn child_of(node: &Node, index: u32) -> Node {
    let mut child = Node {
        error_min: 0.0,
        error_max: 0.0,
        x: node.x * 2 + (index & 1),
        y: node.y * 2 + (index >> 1),
        flipped: node.flipped,
        level: node.level + 1,
    };
    if node.flipped {
        child.x ^= 1;
        child.y ^= 1;
    }
    if index == 3 {
        child.x ^= 1;
        child.y ^= 1;
        child.flipped = !child.flipped;
    }
    child
}
