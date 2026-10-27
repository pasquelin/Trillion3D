//! The binary tree collapsed into a tree of eight children a node, as Ylitie, Karras and Laine
//! collapse it ("Efficient Incoherent Ray Traversal on GPUs Through Compressed Wide BVHs", 2017):
//! a node opens the child of largest surface until it has eight children, or none of them has
//! children of its own; a binary leaf becomes a leaf child of one to three triangles. The children
//! take the slots in the order they were opened. The paper orders them by the octants of a ray's
//! direction so that its walk needs no sorting; the walk here measures the span of every child it
//! meets and goes to the nearest (`wideTraversalWgsl.ts`), so no order is written.
//!
//! The nodes lie breadth first, the internal children of a node one after the other in slot order,
//! and so do the triangles of its leaf children.
use super::abi::RAY_TRACING_WIDTH;
use super::bvh::{Binary, Box3, Kind, Node};
use trillion3d_math::geometry::aabb::half_area;

/// A child of a node.
#[derive(Clone, Copy)]
pub(super) enum Slot {
    Empty,
    /// A node: the box of its subtree. It is the next of the node's internal children not yet met.
    Inner(Box3),
    /// Triangles: their box, how many and where they lie past the node's first (`WideNode::
    /// triangle_base`).
    Leaf {
        bounds: Box3,
        count: usize,
        offset: usize,
    },
}

impl Slot {
    /// The box of what the slot holds, none when it is empty.
    pub(super) fn bounds(&self) -> Option<Box3> {
        match *self {
            Self::Empty => None,
            Self::Inner(bounds) | Self::Leaf { bounds, .. } => Some(bounds),
        }
    }
}

/// A node of eight children.
pub(super) struct WideNode {
    pub bounds: Box3,
    /// The rank of the first of its internal children among the nodes.
    pub child_base: usize,
    /// The rank among the triangles of the first of its leaf children's.
    pub triangle_base: usize,
    pub slots: [Slot; RAY_TRACING_WIDTH],
}

/// The wide tree: its nodes, the root first, and the rank among the binary tree's items of each
/// triangle in the order the leaves take them.
pub(super) struct Wide {
    pub nodes: Vec<WideNode>,
    pub triangles: Vec<usize>,
}

/// The binary nodes that are the children of the node `at`, and how many: its two, then the child
/// of largest surface replaced by its two while there are fewer than eight and one has children;
/// the node itself when it is a leaf.
fn opened(nodes: &[Node], at: usize) -> ([usize; RAY_TRACING_WIDTH], usize) {
    let mut children = [at; RAY_TRACING_WIDTH];
    let Kind::Inner([first, second]) = nodes[at].kind else {
        return (children, 1);
    };
    (children[0], children[1]) = (first, second);
    let mut count = 2;
    let surface = |child: usize| half_area(nodes[child].bounds.0, nodes[child].bounds.1);
    while count < RAY_TRACING_WIDTH {
        let inner = (0..count).filter_map(|k| match nodes[children[k]].kind {
            Kind::Inner(pair) => Some((k, pair)),
            Kind::Leaf { .. } => None,
        });
        // Among equal surfaces, the earlier child.
        let widest = inner.max_by(|&(a, _), &(b, _)| {
            (surface(children[a]).total_cmp(&surface(children[b]))).then(b.cmp(&a))
        });
        let Some((widest, [first, second])) = widest else {
            break;
        };
        children.copy_within(widest + 1..count, widest + 2);
        (children[widest], children[widest + 1]) = (first, second);
        count += 1;
    }
    (children, count)
}

/// The most nodes the walk's stack holds going down `wide` (`RAY_TRACING_STACK`). At a node the walk
/// keeps on its stack every internal child it meets but the nearest, so at most one fewer than the node
/// has internal children, and goes on into a child: the stack needed is that count and the greatest
/// of its children's. A node without internal children needs none.
pub(super) fn stack_need(wide: &Wide) -> usize {
    let mut need = vec![0; wide.nodes.len()];
    // A node's internal children lie after it.
    for (rank, node) in wide.nodes.iter().enumerate().rev() {
        let inner = (node.slots.iter())
            .filter(|slot| matches!(slot, Slot::Inner(_)))
            .count();
        if inner > 0 {
            let deepest = (node.child_base..node.child_base + inner).map(|child| need[child]);
            need[rank] = inner - 1 + deepest.max().unwrap_or(0);
        }
    }
    need.first().copied().unwrap_or(0)
}

/// The wide tree of `binary`.
pub(super) fn collapse(binary: &Binary) -> Wide {
    let nodes = &binary.nodes;
    let mut wide = Wide {
        nodes: Vec::new(),
        triangles: Vec::new(),
    };
    // The binary nodes of the wide ones, in their order: a node's internal children are appended
    // as it is built, after all those queued before.
    let mut queue = vec![0];
    while wide.nodes.len() < queue.len() {
        let bounds = nodes[queue[wide.nodes.len()]].bounds;
        let (children, count) = opened(nodes, queue[wide.nodes.len()]);
        let (child_base, triangle_base) = (queue.len(), wide.triangles.len());
        let mut slots = [Slot::Empty; RAY_TRACING_WIDTH];
        for (slot, &child) in children[..count].iter().enumerate() {
            let bounds = nodes[child].bounds;
            slots[slot] = match nodes[child].kind {
                Kind::Inner(_) => {
                    queue.push(child);
                    Slot::Inner(bounds)
                }
                Kind::Leaf { first, count } => {
                    let offset = wide.triangles.len() - triangle_base;
                    wide.triangles.extend(&binary.order[first..first + count]);
                    Slot::Leaf {
                        bounds,
                        count,
                        offset,
                    }
                }
            };
        }
        wide.nodes.push(WideNode {
            bounds,
            child_base,
            triangle_base,
            slots,
        });
    }
    wide
}
