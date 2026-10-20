//! The sparse float tree the level set is written to and meshed from (`mesh_to_volume.rs`,
//! `volume_to_mesh.rs`): 8³ leaves holding a value and an active bit per voxel, 16³ leaves per
//! lower internal node, 32³ lower nodes per upper node, the upper nodes in a root map. Only the
//! leaves are stored as nodes; the internal nodes' tiles — the values the signed flood fill and the
//! level set pruning write between the leaves — are kept in a table per node that holds a leaf, so
//! `value` answers the tree's value anywhere. Every tile of these grids is inactive: the mesher
//! never sees an active tile.
//! The signed flood fill and the level set's pruning live in `flood`.
pub(super) use super::super::grid_key::{
    leaf_offset, leaf_origin, local_coord, Mask, LEAF_SIDE as DIM, LEAF_SIZE as SIZE,
};
use trillion3d_page_codec::hash::WordMap;
mod flood;

pub(super) type Coord = [i32; 3];

/// The invalid index read as a signed 32-bit integer: an index grid's background.
pub(super) const INVALID: i32 = -1;

/// `v` normalized in the caller's precision: unchanged when its length is within `tolerance` of
/// zero.
pub(super) fn normalize<T: trillion3d_math::real::Real + PartialOrd>(
    v: [T; 3],
    tolerance: T,
) -> [T; 3] {
    trillion3d_math::vec3::unit_where(v, |d| d.abs() > tolerance).unwrap_or(v)
}

pub(super) fn add(a: Coord, b: Coord) -> Coord {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

/// The order the tree lists its leaves in: the root's upper nodes by origin, lexicographic, then
/// each node's children by table offset, x major.
pub(super) fn tree_order(o: Coord) -> (Coord, u32, u32) {
    let upper = [o[0] & !4095, o[1] & !4095, o[2] & !4095];
    let lower =
        (((o[0] & 4095) >> 7) << 10 | ((o[1] & 4095) >> 7) << 5 | ((o[2] & 4095) >> 7)) as u32;
    let leaf = (((o[0] & 127) >> 3) << 8 | ((o[1] & 127) >> 3) << 4 | ((o[2] & 127) >> 3)) as u32;
    (upper, lower, leaf)
}

/// The 26 neighbour offsets of a voxel: face, edge then corner neighbours.
pub(super) const COORD_OFFSETS: [Coord; 26] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, -1],
    [-1, 0, -1],
    [1, 0, 1],
    [-1, 0, 1],
    [1, 1, 0],
    [-1, 1, 0],
    [1, -1, 0],
    [-1, -1, 0],
    [0, -1, 1],
    [0, -1, -1],
    [0, 1, 1],
    [0, 1, -1],
    [-1, -1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, 1, 1],
    [1, 1, 1],
    [1, 1, -1],
];

/// A distance leaf with the closest polygon of each voxel beside it: the level set keeps the
/// distance tree and the index tree on the same topology until the narrow band is trimmed.
#[derive(Clone)]
pub(super) struct Leaf {
    pub origin: Coord,
    pub dist: [f32; SIZE],
    pub idx: [i32; SIZE],
    pub on: Mask,
}

impl Leaf {
    pub(super) fn new(origin: Coord) -> Box<Leaf> {
        Box::new(Leaf {
            origin,
            dist: [f32::MAX; SIZE],
            idx: [INVALID; SIZE],
            on: Mask::default(),
        })
    }
}

const LOWER: i32 = 128;
const UPPER: i32 = 4096;

fn lower_origin(c: Coord) -> Coord {
    [
        c[0] & !(LOWER - 1),
        c[1] & !(LOWER - 1),
        c[2] & !(LOWER - 1),
    ]
}

fn upper_origin(c: Coord) -> Coord {
    [
        c[0] & !(UPPER - 1),
        c[1] & !(UPPER - 1),
        c[2] & !(UPPER - 1),
    ]
}

fn lower_slot(c: Coord) -> usize {
    (((c[0] & 127) >> 3) << 8 | ((c[1] & 127) >> 3) << 4 | ((c[2] & 127) >> 3)) as usize
}

fn upper_slot(c: Coord) -> usize {
    (((c[0] & 4095) >> 7) << 10 | ((c[1] & 4095) >> 7) << 5 | ((c[2] & 4095) >> 7)) as usize
}

/// The float grid: its leaves in tree order, their lookup, the tiles of the internal nodes that
/// hold them, the root's tiles and its background.
pub(super) struct Grid {
    pub leaves: Vec<Box<Leaf>>,
    pub find: WordMap<Coord, u32>,
    lower: WordMap<Coord, Vec<f32>>,
    upper: WordMap<Coord, Vec<f32>>,
    root: WordMap<Coord, f32>,
    pub background: f32,
}

impl Grid {
    /// The grid of these leaves, every tile at `background`.
    pub(super) fn new(mut leaves: Vec<Box<Leaf>>, background: f32) -> Grid {
        leaves.sort_unstable_by_key(|l| tree_order(l.origin));
        let mut grid = Grid {
            leaves,
            find: WordMap::default(),
            lower: WordMap::default(),
            upper: WordMap::default(),
            root: WordMap::default(),
            background,
        };
        grid.reindex();
        grid
    }

    fn reindex(&mut self) {
        self.find = self
            .leaves
            .iter()
            .enumerate()
            .map(|(i, l)| (l.origin, i as u32))
            .collect();
    }

    pub(super) fn leaf(&self, origin: Coord) -> Option<&Leaf> {
        self.find.get(&origin).map(|&i| &*self.leaves[i as usize])
    }

    /// The value at voxel `c`: its leaf's, else the tile's that holds it.
    pub(super) fn value(&self, c: Coord) -> f32 {
        if let Some(leaf) = self.leaf(leaf_origin(c)) {
            return leaf.dist[leaf_offset(c)];
        }
        if let Some(table) = self.lower.get(&lower_origin(c)) {
            return table[lower_slot(c)];
        }
        if let Some(table) = self.upper.get(&upper_origin(c)) {
            return table[upper_slot(c)];
        }
        *self.root.get(&upper_origin(c)).unwrap_or(&self.background)
    }

    /// The inactive leaves pruned before any tile is read: a leaf without an active voxel becomes a
    /// background tile.
    pub(super) fn prune_inactive(&mut self) {
        self.leaves.retain(|l| !l.on.is_empty());
        self.reindex();
    }

    /// The first or, `last`, the last value of a lower node.
    fn lower_end(&self, origin: Coord, last: bool) -> f32 {
        let corner = if last {
            add(origin, [LOWER - 1; 3])
        } else {
            origin
        };
        match self.leaf(leaf_origin(corner)) {
            Some(leaf) => leaf.dist[if last { SIZE - 1 } else { 0 }],
            None => self.lower[&origin][if last { 4095 } else { 0 }],
        }
    }

    fn upper_end(&self, origin: Coord, last: bool) -> f32 {
        let corner = if last {
            add(origin, [UPPER - 1; 3])
        } else {
            origin
        };
        let lower = lower_origin(corner);
        if self.lower.contains_key(&lower) {
            self.lower_end(lower, last)
        } else {
            self.upper[&origin][if last { 32767 } else { 0 }]
        }
    }
}
