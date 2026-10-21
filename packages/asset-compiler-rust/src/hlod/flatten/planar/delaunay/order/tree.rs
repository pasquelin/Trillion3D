//! The quadtree one round of the insertion order is read through, ten levels deep.
//!
//! A point descends from the root by its quadrant against each cell's centre — `+1` when right of
//! it, `+2` when above, strictly — the cell halved on the way. Above the last level a node is a
//! leaf holding up to four points in arrival order; a fifth turns it into an inner node: its four
//! points are pushed to the children of their quadrants (created when missing), in the order the
//! leaf held them, and the new point goes on down. At the last level a node holds, per quadrant
//! of its own centre, a bucket of points in arrival order. A leaf split one level above the last
//! pushes its points into the buckets of its children, each child's centre taken — as is — as
//! the parent's centre offset by `(±½, −½ or +1½)` times half the size of the root's extent, not
//! the parent cell's, whereas the points arriving later read the child cell's true centre.
//!
//! Reading the tree (`write_curve`) visits the children in quadrant order (`0` to `3`, or `3` to
//! `0` reversed), a leaf's points in the order it holds them whatever the direction, a last-level
//! node's buckets in quadrant order (reversed or not), each bucket's points in arrival order.
use trillion3d_math::geometry::aabb::centre;
use trillion3d_math::vector::vecn::{scale, sub};

/// The levels below the root: nodes at this depth hold buckets.
const DEPTH: usize = 10;
/// An empty child, leaf place or bucket.
const EMPTY: i32 = -1;
/// An inner node's entry for a missing child: `EMPTY` encoded (`encoded`).
const NO_CHILD: i32 = -2;

/// An axis-aligned rectangle, empty when its low corner lies above its high one on an axis.
#[derive(Clone, Copy)]
pub(super) struct Rect {
    low: [f64; 2],
    high: [f64; 2],
}

impl Rect {
    /// The empty rectangle: low at the greatest float, high at its negation.
    pub(super) fn nothing() -> Self {
        Self {
            low: [f64::MAX; 2],
            high: [-f64::MAX; 2],
        }
    }

    /// The rectangle grown to hold `point`: each bound moved when the coordinate lies strictly
    /// beyond it (a NaN coordinate moves none).
    pub(super) fn grow(&mut self, point: [f64; 2]) {
        for (axis, &value) in point.iter().enumerate() {
            if value < self.low[axis] {
                self.low[axis] = value;
            }
            if value > self.high[axis] {
                self.high[axis] = value;
            }
        }
    }

    /// Whether the rectangle holds nothing.
    fn holds_nothing(&self) -> bool {
        self.high[0] < self.low[0] || self.high[1] < self.low[1]
    }

    /// Half the rectangle's size on each axis.
    fn half_size(&self) -> [f64; 2] {
        scale(sub(self.high, self.low), 0.5)
    }

    /// The quarter of the rectangle in `quadrant` about `centre`.
    fn quarter(mut self, centre: [f64; 2], quadrant: usize) -> Self {
        for (axis, bit) in [(0, 1), (1, 2)] {
            if quadrant & bit != 0 {
                self.low[axis] = centre[axis];
            } else {
                self.high[axis] = centre[axis];
            }
        }
        self
    }
}

/// The quadrant of `point` against `centre`.
fn quadrant_of(centre: [f64; 2], point: [f64; 2]) -> usize {
    usize::from(point[0] > centre[0]) + usize::from(point[1] > centre[1]) * 2
}

/// The child entry of inner node `node`: `-node − 3`, so `NO_CHILD` decodes to `EMPTY`.
fn encoded(node: usize) -> i32 {
    -(node as i32) - 3
}

/// The node of an inner node's child entry, `EMPTY` for none.
fn decoded(entry: i32) -> i32 {
    -entry - 3
}

/// The tree of one round (module doc). Each node holds four entries: an inner node its children
/// (`encoded`), a leaf its points (`EMPTY` after the last), a last-level node its buckets.
pub(super) struct QuadTree<'a> {
    positions: &'a [[f64; 2]],
    node_entries: Vec<[i32; 4]>,
    buckets: Vec<Vec<i32>>,
}

impl<'a> QuadTree<'a> {
    /// The tree of the points of `round`, in its order, over `extent` — or over the round's own
    /// extent when `extent` is empty.
    pub(super) fn build(positions: &'a [[f64; 2]], round: &[i32], mut extent: Rect) -> Self {
        if extent.holds_nothing() {
            for &point in round {
                extent.grow(positions[point as usize]);
            }
        }
        let mut built = Self {
            positions,
            node_entries: vec![[EMPTY; 4]],
            buckets: Vec::new(),
        };
        for &point in round {
            built.add(point, &extent);
        }
        built
    }

    /// The child of `node` in `quadrant`, created when missing.
    fn child(&mut self, node: usize, quadrant: usize) -> usize {
        let child = decoded(self.node_entries[node][quadrant]);
        if child != EMPTY {
            return child as usize;
        }
        self.node_entries.push([EMPTY; 4]);
        let child = self.node_entries.len() - 1;
        self.node_entries[node][quadrant] = encoded(child);
        child
    }

    /// `point` held by leaf `node` in its first empty place, `false` when the leaf is full.
    fn hold(&mut self, node: usize, point: i32) -> bool {
        match self.node_entries[node]
            .iter()
            .position(|&entry| entry == EMPTY)
        {
            Some(place) => {
                self.node_entries[node][place] = point;
                true
            }
            None => false,
        }
    }

    /// `point` added to the bucket of its quadrant about `centre` in last-level `node`.
    fn bucket(&mut self, node: usize, centre: [f64; 2], point: i32) {
        let quadrant = quadrant_of(centre, self.positions[point as usize]);
        if self.node_entries[node][quadrant] == EMPTY {
            self.node_entries[node][quadrant] = self.buckets.len() as i32;
            self.buckets.push(Vec::new());
        }
        self.buckets[self.node_entries[node][quadrant] as usize].push(point);
    }

    /// `point` placed in the tree over `root` (module doc).
    fn add(&mut self, point: i32, root: &Rect) {
        let position = self.positions[point as usize];
        let (mut node, mut cell) = (0, *root);
        for depth in 0.. {
            let middle = centre(cell.low, cell.high);
            if depth >= DEPTH {
                self.bucket(node, middle, point);
                return;
            }
            if self.node_entries[node][0] >= EMPTY {
                if self.hold(node, point) {
                    return;
                }
                let held = self.node_entries[node];
                self.node_entries[node] = [NO_CHILD; 4];
                for old in held {
                    let quadrant = quadrant_of(middle, self.positions[old as usize]);
                    let child = self.child(node, quadrant);
                    if depth + 1 >= DEPTH {
                        // The child's centre offset from the root's half size, its `y` offset
                        // `+1½` above (the quadrant's bit 2 read as two): kept as it is.
                        let half = root.half_size();
                        let offset = [(quadrant & 1) as f64 - 0.5, (quadrant & 2) as f64 - 0.5];
                        let skewed = [
                            middle[0] + offset[0] * half[0],
                            middle[1] + offset[1] * half[1],
                        ];
                        self.bucket(child, skewed, old);
                    } else {
                        self.hold(child, old);
                    }
                }
            }
            let quadrant = quadrant_of(middle, position);
            node = self.child(node, quadrant);
            cell = cell.quarter(middle, quadrant);
        }
    }

    /// The round's points written over `round` in the tree's curve order, children in reverse
    /// quadrant order when `reversed`.
    pub(super) fn write_curve(&self, round: &mut [i32], reversed: bool) {
        let mut written = 0;
        self.write_node(0, 0, reversed, round, &mut written);
    }

    /// The points under `node` at `depth` written from `round[*written]` on (`write_curve`).
    fn write_node(
        &self,
        node: usize,
        depth: usize,
        reversed: bool,
        round: &mut [i32],
        written: &mut usize,
    ) {
        let entries = self.node_entries[node];
        let in_order = |quadrant: usize| if reversed { 3 - quadrant } else { quadrant };
        if depth >= DEPTH {
            for quadrant in 0..4 {
                let bucket = entries[in_order(quadrant)];
                if bucket == EMPTY {
                    continue;
                }
                for &point in &self.buckets[bucket as usize] {
                    round[*written] = point;
                    *written += 1;
                }
            }
            return;
        }
        if entries[0] >= EMPTY {
            for &point in entries.iter().take_while(|&&entry| entry != EMPTY) {
                round[*written] = point;
                *written += 1;
            }
            return;
        }
        for quadrant in 0..4 {
            let child = decoded(entries[in_order(quadrant)]);
            if child != EMPTY {
                self.write_node(child as usize, depth + 1, reversed, round, written);
            }
        }
    }
}
