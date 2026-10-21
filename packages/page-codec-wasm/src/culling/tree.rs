//! The tree over group parts (`super::build_culling_bvh`), as the reference builds it.
//!
//! **Per level.** The parts of each level, from the finest, get a tree of their own
//! (`top_down`): `n` items under one node are split into `CULLING_FANOUT` children of complete
//! subtrees — the largest power of the fanout `T` with `T · fanout > n`, each child `T / fanout`
//! items and the excess `n − T` handed out from the last child on, at most `T − T / fanout` each —,
//! so every level of the tree is full but its last, and at most one node is partly filled. Before
//! a node's children are cut, its parts are sorted (`sort_parts`): two binary splits, each part of
//! the slice sorted by its box's centre along each of the three axes in turn, the axis whose two
//! sides' boxes have the least summed surface kept — sorted again on it unless it was the last
//! tried. A level whose root is a part or a full node gives that root; a partly filled root gives
//! its children instead.
//!
//! **Over the levels** (`level_roots`). One root takes the three coarsest of those roots and, as
//! its fourth child, the tree of the others — a node of them when they fit one, else a complete
//! tree of them, unsorted (`top_down`).
//!
//! The nodes are then laid out breadth first (`nodes`): a node's children side by side after it,
//! each node's values those of its part, or of its children (`CullingNode::over`).
use super::{CullingNode, CullingPart, CULLING_FANOUT};
use std::collections::{BTreeMap, VecDeque};
use trillion3d_math::geometry::aabb::{aabb_of_boxes, half_area};

/// The binary splits a node's parts are sorted by: the fanout's power of two.
const FANOUT_BITS: u32 = CULLING_FANOUT.trailing_zeros();
/// The coarsest level roots the top root takes beside the tree of the others.
const CHAINED: usize = CULLING_FANOUT - 1;

/// One node of the tree being built: a part — item `i` is part `i` — or the items it holds.
#[derive(Default)]
struct Item {
    part: Option<usize>,
    children: Vec<usize>,
}

/// The tree being built over the parts.
struct Tree<'a> {
    parts: &'a [CullingPart],
    items: Vec<Item>,
}

impl Tree<'_> {
    /// A new node over `children`.
    fn node(&mut self, children: Vec<usize>) -> usize {
        self.items.push(Item {
            part: None,
            children,
        });
        self.items.len() - 1
    }

    /// The half surface of the box of parts `ids`, in single precision, as the sort's cost weighs
    /// it.
    fn surface(&self, ids: &[usize]) -> f32 {
        let boxes = ids
            .iter()
            .map(|&id| (self.parts[id].min, self.parts[id].max));
        let (low, high) = aabb_of_boxes(boxes);
        half_area(low.map(|v| v as f32), high.map(|v| v as f32))
    }

    /// Parts `ids` by their box's centre on `axis`, in single precision; ties keep their order.
    fn sort_on(&self, ids: &mut [usize], axis: usize) {
        let centre = |id: usize| {
            let part = &self.parts[id];
            (part.max[axis] as f32 + part.min[axis] as f32) * 0.5
        };
        ids.sort_by(|&a, &b| centre(a).total_cmp(&centre(b)));
    }

    /// Parts `ids` sorted for the children of `sizes` items each: at each of `FANOUT_BITS` binary
    /// splits, every bucket's slice sorted on the axis whose two sides cost least (`surface`).
    fn sort_parts(&self, ids: &mut [usize], sizes: &[usize; CULLING_FANOUT]) {
        for split in 0..FANOUT_BITS {
            let per_bucket = CULLING_FANOUT >> split;
            let half = per_bucket >> 1;
            let mut start = 0;
            for bucket in 0..1usize << split {
                let first = per_bucket * bucket;
                let left: usize = sizes[first..first + half].iter().sum();
                let right: usize = sizes[first + half..first + per_bucket].iter().sum();
                let both = &mut ids[start..start + left + right];
                start += left + right;
                let mut best = (f32::MAX, 0);
                for axis in 0..3 {
                    self.sort_on(both, axis);
                    let cost = self.surface(&both[..left]) + self.surface(&both[left..]);
                    if cost < best.0 {
                        best = (cost, axis);
                    }
                }
                if best.1 != 2 {
                    self.sort_on(both, best.1);
                }
            }
        }
    }

    /// The complete tree over items `ids`, its parts sorted first when `sorted`: the item itself
    /// for one, a node of them for up to the fanout.
    fn top_down(&mut self, ids: &mut [usize], sorted: bool) -> usize {
        let n = ids.len();
        if n == 1 {
            return ids[0];
        }
        let at = self.node(Vec::new());
        if n <= CULLING_FANOUT {
            self.items[at].children = ids.to_vec();
            return at;
        }
        let mut top = CULLING_FANOUT;
        while top * CULLING_FANOUT <= n {
            top *= CULLING_FANOUT;
        }
        let small = top / CULLING_FANOUT;
        let most = top - small;
        let (mut sizes, mut excess) = ([0usize; CULLING_FANOUT], n - top);
        for size in sizes.iter_mut().rev() {
            let extra = excess.min(most);
            *size = small + extra;
            excess -= extra;
        }
        if sorted {
            self.sort_parts(ids, &sizes);
        }
        let mut offset = 0;
        for size in sizes {
            let child = self.top_down(&mut ids[offset..offset + size], sorted);
            self.items[at].children.push(child);
            offset += size;
        }
        at
    }

    /// The root over the levels' `roots`, finest first: itself for one, a node of them for up to
    /// the fanout; else, while `chain` lasts, a node of the `CHAINED` coarsest and of the root over
    /// the others, and past it the complete tree of them, unsorted.
    fn level_roots(&mut self, roots: &mut [usize], chain: u32) -> usize {
        let n = roots.len();
        if n == 1 {
            return roots[0];
        }
        if n <= CULLING_FANOUT {
            return self.node(roots.to_vec());
        }
        if chain == 0 {
            return self.top_down(roots, false);
        }
        let at = self.node(roots[n - CHAINED..].to_vec());
        let others = self.level_roots(&mut roots[..n - CHAINED], chain - 1);
        self.items[at].children.push(others);
        at
    }

    /// The root of the whole tree: an empty node for no part, a node over the only one, else the
    /// root over every level's tree (`level_roots`), one level of chaining.
    fn root(&mut self) -> usize {
        match self.parts.len() {
            0 => self.node(Vec::new()),
            1 => self.node(vec![0]),
            _ => {
                let mut levels: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
                for (id, part) in self.parts.iter().enumerate() {
                    levels.entry(part.level).or_default().push(id);
                }
                let mut roots = Vec::new();
                for (_, mut ids) in levels {
                    let root = self.top_down(&mut ids, true);
                    let item = &self.items[root];
                    if item.part.is_some() || item.children.len() == CULLING_FANOUT {
                        roots.push(root);
                    } else {
                        roots.extend(item.children.iter().copied());
                    }
                }
                self.level_roots(&mut roots, 1)
            }
        }
    }

    /// The values of item `at` (`CullingNode::leaf`, `CullingNode::over`), each item's once, its
    /// children's first.
    fn value(&self, at: usize, values: &mut [Option<CullingNode>]) {
        if values[at].is_some() {
            return;
        }
        let item = &self.items[at];
        let value = match item.part {
            Some(part) => CullingNode::leaf(&self.parts[part]),
            None => {
                item.children
                    .iter()
                    .for_each(|&child| self.value(child, values));
                let children: Vec<&CullingNode> = (item.children.iter())
                    .map(|&child| values[child].as_ref().expect("a child's value"))
                    .collect();
                CullingNode::over(&children)
            }
        };
        values[at] = Some(value);
    }
}

/// The hierarchy over `parts`, laid out breadth first from its root.
pub(super) fn nodes(parts: &[CullingPart]) -> Vec<CullingNode> {
    let items = (0..parts.len())
        .map(|id| Item {
            part: Some(id),
            children: Vec::new(),
        })
        .collect();
    let mut tree = Tree { parts, items };
    let root = tree.root();
    let mut values = vec![None; tree.items.len()];
    tree.value(root, &mut values);
    let mut taken = |at: usize| values[at].take().expect("a value for every node reached");
    let mut nodes = vec![taken(root)];
    let mut queue = VecDeque::from([(root, 0usize)]);
    while let Some((at, index)) = queue.pop_front() {
        let children = &tree.items[at].children;
        if children.is_empty() {
            continue;
        }
        nodes[index].first_child = nodes.len();
        nodes[index].child_count = children.len();
        for &child in children {
            queue.push_back((child, nodes.len()));
            nodes.push(taken(child));
        }
    }
    nodes
}
