//! The binary tree over the cut's triangles, split by the surface area heuristic: at each node the
//! triangles' centres are dropped into `BINS` bins along each axis, and the cut between two bins
//! that costs least — each side's box surface times its triangle count — is taken. A node of more than a leaf's triangles is always split; a node of no more is a leaf.
//!
//! The page codec's proxy builder (`split::bisect_least_cost`) is not reused: it takes `f64`
//! inputs, costs a split by the squared diagonal of each side and keeps a balanced four-wide median
//! contract, where a ray tree needs the surface area cost, `f32`, leaves of up to three triangles
//! and the collapse into eight children (`wide.rs`).
use super::abi::RAY_TRACING_LEAF_TRIANGLES;
use super::cut::CutTriangle;
use trillion3d_math::geometry::aabb::{aabb_of_f32, extend_aabb_f32, half_area};

/// The bins a node's centres are dropped into along an axis.
const BINS: usize = 16;

/// A box as its low and its high corner.
pub(super) type Box3 = ([f32; 3], [f32; 3]);

/// What the tree is built from for a triangle: its box and its centre.
pub(super) struct Item {
    pub bounds: Box3,
    pub centre: [f32; 3],
}

impl Item {
    pub(super) fn of(triangle: &CutTriangle) -> Self {
        let bounds = aabb_of_f32(triangle.corners);
        Self {
            bounds,
            centre: centre_of(bounds),
        }
    }
}

/// The centre of `bounds`.
pub(super) fn centre_of((low, high): Box3) -> [f32; 3] {
    [0, 1, 2].map(|axis| (low[axis] + high[axis]) * 0.5)
}

/// What a node holds: a range of the tree's order, or two children.
#[derive(Clone, Copy)]
pub(super) enum Kind {
    Leaf { first: usize, count: usize },
    Inner([usize; 2]),
}

/// A node and its box.
pub(super) struct Node {
    pub bounds: Box3,
    pub kind: Kind,
}

/// The tree: its nodes, the root first, and the items in the order its leaves take them.
pub(super) struct Binary {
    pub nodes: Vec<Node>,
    pub order: Vec<usize>,
}

/// The box of the items `ids`.
fn bounds_of(items: &[Item], ids: &[usize]) -> Box3 {
    aabb_of_f32(
        ids.iter()
            .flat_map(|&id| [items[id].bounds.0, items[id].bounds.1]),
    )
}

/// The bins along one axis: where the first begins and how many fit in a unit of length.
struct Binning {
    axis: usize,
    origin: f32,
    scale: f32,
}

impl Binning {
    /// The bin of `item`'s centre.
    fn bin(&self, item: &Item) -> usize {
        let at = (item.centre[self.axis] - self.origin) * self.scale;
        (at as usize).min(BINS - 1)
    }
}

/// A cut: the bins up to `bin` on one side, the others on the other, what it costs and the box of
/// each side.
struct BinCut {
    binning: Binning,
    bin: usize,
    cost: f32,
    sides: [Box3; 2],
}

/// What a bin holds: how many items and the box of them.
#[derive(Clone, Copy)]
struct Bin {
    count: usize,
    bounds: Box3,
}

impl Bin {
    const EMPTY: Self = Self {
        count: 0,
        bounds: ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]),
    };

    /// This bin and `other`, together: an empty one adds nothing, its box being the inverted one.
    fn joined(self, other: &Self) -> Self {
        if other.count == 0 {
            return self;
        }
        if self.count == 0 {
            return *other;
        }
        let (mut low, mut high) = self.bounds;
        extend_aabb_f32(&mut low, &mut high, other.bounds.0);
        extend_aabb_f32(&mut low, &mut high, other.bounds.1);
        Self {
            count: self.count + other.count,
            bounds: (low, high),
        }
    }

    /// What testing this bin's items would cost the walk if it were a node's side: the box's
    /// surface times the count.
    fn weight(&self) -> f32 {
        half_area(self.bounds.0, self.bounds.1) * self.count as f32
    }
}

/// The cheapest cut along `binning`'s axis of the node `ids`; none when the centres lie in one
/// place, or in one bin.
fn axis_cut(items: &[Item], ids: &[usize], binning: Binning) -> Option<BinCut> {
    let mut bins = [Bin::EMPTY; BINS];
    for &id in ids {
        let bin = binning.bin(&items[id]);
        let one = Bin {
            count: 1,
            bounds: items[id].bounds,
        };
        bins[bin] = bins[bin].joined(&one);
    }
    // What lies past each bin: the weight of the bins after it and how many items they hold.
    let mut past = [Bin::EMPTY; BINS];
    for bin in (0..BINS - 1).rev() {
        past[bin] = past[bin + 1].joined(&bins[bin + 1]);
    }
    let mut before = Bin::EMPTY;
    let mut best: Option<(usize, f32, [Box3; 2])> = None;
    for bin in 0..BINS - 1 {
        before = before.joined(&bins[bin]);
        if before.count == 0 || past[bin].count == 0 {
            continue;
        }
        let cost = before.weight() + past[bin].weight();
        if best.is_none_or(|(_, least, _)| cost < least) {
            best = Some((bin, cost, [before.bounds, past[bin].bounds]));
        }
    }
    let (bin, cost, sides) = best?;
    Some(BinCut {
        binning,
        bin,
        cost,
        sides,
    })
}

/// The cheapest cut of the node `ids` over the three axes, none when no axis has one.
fn cheapest_cut(items: &[Item], ids: &[usize]) -> Option<BinCut> {
    let (low, high) = aabb_of_f32(ids.iter().map(|&id| items[id].centre));
    (0..3)
        .filter(|&axis| high[axis] > low[axis])
        .filter_map(|axis| {
            let scale = BINS as f32 / (high[axis] - low[axis]);
            let binning = Binning {
                axis,
                origin: low[axis],
                scale,
            };
            axis_cut(items, ids, binning)
        })
        .min_by(|a, b| a.cost.total_cmp(&b.cost))
}

/// `ids` reordered so that the items on the first side of `cut` come first; the size of that side.
fn partition(items: &[Item], ids: &mut [usize], cut: &BinCut) -> usize {
    let mut first = 0;
    for at in 0..ids.len() {
        if cut.binning.bin(&items[ids[at]]) <= cut.bin {
            ids.swap(at, first);
            first += 1;
        }
    }
    first
}

/// `ids` cut in two halves around the median centre along the axis its centres spread most on,
/// where no bin cut exists — centres on one point, or all in one bin; the size of the first half
/// and the box of each.
fn halved(items: &[Item], ids: &mut [usize]) -> (usize, [Box3; 2]) {
    let (low, high) = aabb_of_f32(ids.iter().map(|&id| items[id].centre));
    let axis = (0..3)
        .max_by(|&a, &b| (high[a] - low[a]).total_cmp(&(high[b] - low[b])))
        .unwrap_or(0);
    let middle = ids.len() / 2;
    ids.select_nth_unstable_by(middle, |&a, &b| {
        (items[a].centre[axis].total_cmp(&items[b].centre[axis])).then(a.cmp(&b))
    });
    let (first, second) = ids.split_at(middle);
    (middle, [bounds_of(items, first), bounds_of(items, second)])
}

/// How `ids`, the items of a node, divide: the size of the first part and the box
/// of each, none for a leaf — a node of no more than `RAY_TRACING_LEAF_TRIANGLES` items. A larger
/// one is always split, at its cheapest cut, or in halves where it has none.
fn split(items: &[Item], ids: &mut [usize]) -> Option<(usize, [Box3; 2])> {
    if ids.len() <= RAY_TRACING_LEAF_TRIANGLES {
        return None;
    }
    Some(match cheapest_cut(items, ids) {
        Some(cut) => (partition(items, ids, &cut), cut.sides),
        None => halved(items, ids),
    })
}

/// A node not yet known.
fn unset() -> Node {
    Node {
        bounds: ([0.0; 3], [0.0; 3]),
        kind: Kind::Leaf { first: 0, count: 0 },
    }
}

/// The tree over `items`, of which there is at least one.
pub(super) fn build(items: &[Item]) -> Binary {
    let mut order: Vec<usize> = (0..items.len()).collect();
    let mut nodes = vec![unset()];
    // The nodes to fill: where each lies, the range of the order it covers and its box.
    let mut pending = vec![(0, 0, items.len(), bounds_of(items, &order))];
    while let Some((at, from, to, bounds)) = pending.pop() {
        let kind = match split(items, &mut order[from..to]) {
            None => Kind::Leaf {
                first: from,
                count: to - from,
            },
            Some((size, sides)) => {
                let children = [nodes.len(), nodes.len() + 1];
                nodes.extend([unset(), unset()]);
                pending.push((children[0], from, from + size, sides[0]));
                pending.push((children[1], from + size, to, sides[1]));
                Kind::Inner(children)
            }
        };
        nodes[at] = Node { bounds, kind };
    }
    Binary { nodes, order }
}
