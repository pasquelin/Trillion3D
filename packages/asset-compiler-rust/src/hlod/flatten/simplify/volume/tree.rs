//! The sparse voxel tree every field of the method lives in: a root map of upper nodes, each a
//! 32³ table of lower nodes or tiles, each a 16³ table of leaves or tiles, each leaf an 8³ block
//! of values with a mask of the active ones — a leaf covers 8 voxels a side, a lower node 128, an
//! upper node 4096. A coordinate no leaf holds reads the tile above it, or the tree's background
//! past every node. Every tile is inactive: the fields the method builds never hold an active
//! tile.
//!
//! The layout is the method's own, not a convenience: its steps read a voxel's neighbours across
//! leaves, fill each node's tiles from the signs of its children in table order (`fill.rs`),
//! replace inactive children by tiles (`collapse_tiles.rs`) and visit the leaves in the tree's
//! order — upper nodes by their origins, then each table in its own order, `x` slowest, `z`
//! fastest —, and each of those decides the field's values. The leaf lives in `leaf`.
use std::collections::BTreeMap;
mod leaf;
pub(crate) use leaf::Leaf;

/// A voxel's integer coordinates.
pub(crate) type Coord = [i32; 3];

/// A leaf's side and voxel count, a lower node's and an upper node's sides in children.
pub(crate) const LEAF_SIDE: i32 = 8;
pub(crate) const LEAF_SIZE: usize = 512;
const LOWER_SIDE: usize = 16;
const UPPER_SIDE: usize = 32;

/// The voxels a lower node and an upper node cover a side.
pub(crate) const LOWER_SPAN: i32 = LEAF_SIDE * LOWER_SIDE as i32;
pub(crate) const UPPER_SPAN: i32 = LOWER_SPAN * UPPER_SIDE as i32;

/// The voxel `c` moved by `d`.
pub(crate) fn shift(c: Coord, d: Coord) -> Coord {
    [c[0] + d[0], c[1] + d[1], c[2] + d[2]]
}

/// The origin of the block of `span` voxels a side holding `c`.
pub(crate) fn origin_of(c: Coord, span: i32) -> Coord {
    c.map(|x| x & !(span - 1))
}

/// A voxel's rank in its leaf: `x` slowest, `z` fastest.
pub(crate) fn offset(c: Coord) -> usize {
    let [x, y, z] = c.map(|x| (x & (LEAF_SIDE - 1)) as usize);
    (x << 6) | (y << 3) | z
}

/// The steps between neighbouring ranks of a leaf along `x`, `y` and `z`.
pub(crate) const STRIDES: [usize; 3] = [64, 8, 1];

/// The coordinates in its leaf of the voxel of rank `pos`.
pub(crate) fn local(pos: usize) -> Coord {
    [(pos >> 6) as i32, ((pos >> 3) & 7) as i32, (pos & 7) as i32]
}

/// A child's rank in a table of `side` children a side, each `span` voxels a side.
fn slot(c: Coord, span: i32, side: usize) -> usize {
    let [x, y, z] = c.map(|x| ((x & (span * side as i32 - 1)) / span) as usize);
    (x * side + y) * side + z
}

/// A table entry: a tile's value, or a child.
#[derive(Clone)]
pub(crate) enum Slot<C, T> {
    Tile(T),
    Child(Box<C>),
}

impl<C, T: Copy> Slot<C, T> {
    /// The tile's value, or what `child` takes from the child.
    fn value_or(&self, child: impl FnOnce(&C) -> T) -> T {
        match self {
            Slot::Tile(v) => *v,
            Slot::Child(node) => child(node),
        }
    }
}

/// Whether a table of `slots` holds no child.
fn all_tiles<C, T>(slots: &[Slot<C, T>]) -> bool {
    slots.iter().all(|s| matches!(s, Slot::Tile(_)))
}

/// A 16³ table of leaves and tiles.
#[derive(Clone)]
pub(crate) struct Lower<T> {
    pub slots: Vec<Slot<Leaf<T>, T>>,
}

/// A 32³ table of lower nodes and tiles.
#[derive(Clone)]
pub(crate) struct Upper<T> {
    pub slots: Vec<Slot<Lower<T>, T>>,
}

impl<T: Copy> Lower<T> {
    fn filled(value: T) -> Self {
        let slots = (0..LOWER_SIDE.pow(3)).map(|_| Slot::Tile(value)).collect();
        Self { slots }
    }
    /// The value of its first and its last voxel, in table order.
    pub(crate) fn first_value(&self) -> T {
        self.slots[0].value_or(|leaf| leaf.values[0])
    }
    pub(crate) fn last_value(&self) -> T {
        self.slots[self.slots.len() - 1].value_or(|leaf| leaf.values[LEAF_SIZE - 1])
    }
    /// Whether it holds no child.
    pub(crate) fn inactive(&self) -> bool {
        all_tiles(&self.slots)
    }
}

impl<T: Copy> Upper<T> {
    fn filled(value: T) -> Self {
        let slots = (0..UPPER_SIDE.pow(3)).map(|_| Slot::Tile(value)).collect();
        Self { slots }
    }
    pub(crate) fn first_value(&self) -> T {
        self.slots[0].value_or(|lower| lower.first_value())
    }
    pub(crate) fn last_value(&self) -> T {
        self.slots[self.slots.len() - 1].value_or(|lower| lower.last_value())
    }
    pub(crate) fn inactive(&self) -> bool {
        all_tiles(&self.slots)
    }
}

/// The tree: its background and its root's entries by upper origin, in the order the method
/// visits them.
#[derive(Clone)]
pub(crate) struct Tree<T> {
    pub background: T,
    pub root: BTreeMap<Coord, Slot<Upper<T>, T>>,
}

impl<T: Copy> Tree<T> {
    /// An empty tree reading `background` everywhere.
    pub(crate) fn new(background: T) -> Self {
        Self {
            background,
            root: BTreeMap::new(),
        }
    }

    /// The value at `c`: its leaf's, else the tile above it, else the background.
    pub(crate) fn get(&self, c: Coord) -> T {
        let upper = match self.root.get(&origin_of(c, UPPER_SPAN)) {
            None => return self.background,
            Some(Slot::Tile(v)) => return *v,
            Some(Slot::Child(upper)) => upper,
        };
        let lower = match &upper.slots[slot(c, LOWER_SPAN, UPPER_SIDE)] {
            Slot::Tile(v) => return *v,
            Slot::Child(lower) => lower,
        };
        match &lower.slots[slot(c, LEAF_SIDE, LOWER_SIDE)] {
            Slot::Tile(v) => *v,
            Slot::Child(leaf) => leaf.values[offset(c)],
        }
    }

    /// The value at `c` and whether it is active (a voxel of a leaf whose bit is on).
    pub(crate) fn probe(&self, c: Coord) -> (T, bool) {
        match self.leaf(c) {
            Some(leaf) => (leaf.values[offset(c)], leaf.is_on(offset(c))),
            None => (self.get(c), false),
        }
    }

    /// The leaf holding `c`, if any.
    pub(crate) fn leaf(&self, c: Coord) -> Option<&Leaf<T>> {
        let Some(Slot::Child(upper)) = self.root.get(&origin_of(c, UPPER_SPAN)) else {
            return None;
        };
        let Slot::Child(lower) = &upper.slots[slot(c, LOWER_SPAN, UPPER_SIDE)] else {
            return None;
        };
        match &lower.slots[slot(c, LEAF_SIDE, LOWER_SIDE)] {
            Slot::Child(leaf) => Some(leaf),
            Slot::Tile(_) => None,
        }
    }

    /// The leaf holding `c`, if any, to write.
    pub(crate) fn leaf_mut(&mut self, c: Coord) -> Option<&mut Leaf<T>> {
        let Some(Slot::Child(upper)) = self.root.get_mut(&origin_of(c, UPPER_SPAN)) else {
            return None;
        };
        let Slot::Child(lower) = &mut upper.slots[slot(c, LOWER_SPAN, UPPER_SIDE)] else {
            return None;
        };
        match &mut lower.slots[slot(c, LEAF_SIDE, LOWER_SIDE)] {
            Slot::Child(leaf) => Some(leaf),
            Slot::Tile(_) => None,
        }
    }

    /// The leaf holding `c`, made where none is: each node and leaf made filled with the value
    /// of the tile it replaces — the background past every node.
    pub(crate) fn touch(&mut self, c: Coord) -> &mut Leaf<T> {
        let background = self.background;
        let key = origin_of(c, UPPER_SPAN);
        let entry = self.root.entry(key).or_insert(Slot::Tile(background));
        if let Slot::Tile(v) = *entry {
            *entry = Slot::Child(Box::new(Upper::filled(v)));
        }
        let Slot::Child(upper) = entry else {
            unreachable!("an upper node was just made")
        };
        let at = &mut upper.slots[slot(c, LOWER_SPAN, UPPER_SIDE)];
        if let Slot::Tile(v) = *at {
            *at = Slot::Child(Box::new(Lower::filled(v)));
        }
        let Slot::Child(lower) = at else {
            unreachable!("a lower node was just made")
        };
        let at = &mut lower.slots[slot(c, LEAF_SIDE, LOWER_SIDE)];
        if let Slot::Tile(v) = *at {
            *at = Slot::Child(Box::new(Leaf::filled(origin_of(c, LEAF_SIDE), v)));
        }
        match at {
            Slot::Child(leaf) => leaf,
            Slot::Tile(_) => unreachable!("a leaf was just made"),
        }
    }

    /// `leaf` put in its place, replacing what stood there.
    pub(crate) fn add(&mut self, leaf: Leaf<T>) {
        let origin = leaf.origin;
        *self.touch(origin) = leaf;
    }

    /// Its leaves in the tree's order.
    pub(crate) fn leaves(&self) -> impl Iterator<Item = &Leaf<T>> {
        (self.root.values())
            .filter_map(|e| match e {
                Slot::Child(upper) => Some(upper),
                Slot::Tile(_) => None,
            })
            .flat_map(|upper| upper.slots.iter())
            .filter_map(|s| match s {
                Slot::Child(lower) => Some(lower),
                Slot::Tile(_) => None,
            })
            .flat_map(|lower| lower.slots.iter())
            .filter_map(|s| match s {
                Slot::Child(leaf) => Some(&**leaf),
                Slot::Tile(_) => None,
            })
    }

    /// Its leaves in the tree's order, to write.
    pub(crate) fn leaves_mut(&mut self) -> Vec<&mut Leaf<T>> {
        let mut out = Vec::new();
        for entry in self.root.values_mut() {
            let Slot::Child(upper) = entry else { continue };
            for lower in upper.slots.iter_mut() {
                let Slot::Child(lower) = lower else { continue };
                for leaf in lower.slots.iter_mut() {
                    if let Slot::Child(leaf) = leaf {
                        out.push(&mut **leaf);
                    }
                }
            }
        }
        out
    }

    /// Its leaves taken out, in the tree's order, each replaced by a background tile.
    pub(crate) fn take_leaves(&mut self) -> Vec<Leaf<T>> {
        let background = self.background;
        let mut out = Vec::new();
        for entry in self.root.values_mut() {
            let Slot::Child(upper) = entry else { continue };
            for lower in upper.slots.iter_mut() {
                let Slot::Child(lower) = lower else { continue };
                for at in lower.slots.iter_mut() {
                    if let Slot::Child(leaf) = std::mem::replace(at, Slot::Tile(background)) {
                        out.push(*leaf);
                    }
                }
            }
        }
        out
    }
}
