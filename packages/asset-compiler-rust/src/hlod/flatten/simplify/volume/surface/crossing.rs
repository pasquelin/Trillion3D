//! The cells the surface may cross, found from the edges between voxels on opposite sides of the
//! iso value: each such edge towards `+x`, `+y` or `+z` marks the four cells around it. Each leaf
//! of the field reads its own edges, those across its three upper faces — to the next leaf, or to
//! the tile or background standing there —, and, where no leaf stands below one of its lower
//! faces, its edges against the tile there.
//!
//! Two quirks of the scan are kept, for they decide which cells are marked: the faces across `y`
//! leave out their last row in `z`, and the scan against a lower tile reads every voxel of the
//! leaf but its last layer along the axis, not only the face, marking the cell below each.
use super::super::tree::{
    local, offset, origin_of, shift, Coord, Leaf, Tree, LEAF_SIDE, LEAF_SIZE, STRIDES,
};
use super::cell::AROUND;
use rayon::prelude::*;
use std::collections::BTreeMap;

/// An edge the surface crosses: its voxel and the axis towards whose `+` it runs.
type Edge = (Coord, usize);

/// The cells marked in one leaf, a bit per cell by rank.
type Marks = [u64; 8];

/// The cells the `level` surface of `field` may cross, as the active voxels of a tree: each crossed
/// edge's voxel and the three others around it. The leaves read their edges and mark the cells
/// they name, by the leaf holding each, in parallel; the marks are a union, the same in any order,
/// so the marks of one leaf are joined and each leaf put in its place once, in the tree's order.
pub(super) fn crossings(field: &Tree<f32>, level: f32) -> Tree<()> {
    let leaves: Vec<&Leaf<f32>> = field.leaves().collect();
    let mut marked: Vec<(Coord, Marks)> = leaves
        .par_iter()
        .flat_map_iter(|leaf| marks_of(&leaf_edges(field, leaf, level)))
        .collect();
    marked.par_sort_unstable_by_key(|&(origin, _)| origin);
    let mut cells = Tree::new(());
    let mut at = 0;
    while at < marked.len() {
        let origin = marked[at].0;
        let mut on = [0u64; 8];
        while at < marked.len() && marked[at].0 == origin {
            (0..8).for_each(|word| on[word] |= marked[at].1[word]);
            at += 1;
        }
        let mut leaf = Leaf::filled(origin, ());
        leaf.on = on;
        cells.add(leaf);
    }
    cells
}

/// The cells `edges` mark, by the origin of the leaf holding them: each edge's voxel and the three
/// others around it.
fn marks_of(edges: &[Edge]) -> BTreeMap<Coord, Marks> {
    let mut marks: BTreeMap<Coord, Marks> = BTreeMap::new();
    for &(c, axis) in edges {
        for cell in std::iter::once(c).chain(AROUND[axis].map(|d| shift(c, d))) {
            let pos = offset(cell);
            marks.entry(origin_of(cell, LEAF_SIDE)).or_default()[pos >> 6] |= 1u64 << (pos & 63);
        }
    }
    marks
}

/// The crossed edges `leaf` reads: inside it, the edges with either voxel active; across an upper
/// face to a leaf, the same; across an upper face to a tile, those whose voxel in `leaf` is active;
/// against a lower tile, the edge below each active voxel off the tile's side.
fn leaf_edges(field: &Tree<f32>, leaf: &Leaf<f32>, level: f32) -> Vec<Edge> {
    let inside = |pos: usize| leaf.values[pos] < level;
    let mut edges = Vec::new();
    for (axis, &stride) in STRIDES.iter().enumerate() {
        for pos in below_last(axis) {
            let next = pos + stride;
            if (leaf.is_on(pos) || leaf.is_on(next)) && inside(pos) != inside(next) {
                edges.push((leaf.coord(pos), axis));
            }
        }
    }
    for (axis, &stride) in STRIDES.iter().enumerate() {
        let mut beyond = leaf.origin;
        beyond[axis] += LEAF_SIDE;
        match field.leaf(beyond) {
            Some(next) => {
                for pos in upper_face(axis) {
                    let across = pos - (LEAF_SIDE as usize - 1) * stride;
                    let active = leaf.is_on(pos) || next.is_on(across);
                    if active && inside(pos) != (next.values[across] < level) {
                        edges.push((leaf.coord(pos), axis));
                    }
                }
            }
            None => {
                let outside = field.get(beyond) < level;
                for pos in upper_face(axis) {
                    if leaf.is_on(pos) && outside != inside(pos) {
                        edges.push((leaf.coord(pos), axis));
                    }
                }
            }
        }
    }
    for axis in 0..3 {
        let mut before = leaf.origin;
        before[axis] -= 1;
        if field.leaf(before).is_some() {
            continue;
        }
        let outside = field.get(before) < level;
        for pos in below_last(axis) {
            if leaf.is_on(pos) && outside != inside(pos) {
                let mut c = leaf.coord(pos);
                c[axis] -= 1;
                edges.push((c, axis));
            }
        }
    }
    edges
}

/// The ranks of a leaf whose coordinate along `axis` is not its last.
fn below_last(axis: usize) -> impl Iterator<Item = usize> {
    (0..LEAF_SIZE).filter(move |&pos| local(pos)[axis] < LEAF_SIDE - 1)
}

/// The ranks of a leaf's last layer along `axis`; across `y`, without its last row in `z`.
fn upper_face(axis: usize) -> impl Iterator<Item = usize> {
    (0..LEAF_SIZE).filter(move |&pos| {
        let l = local(pos);
        l[axis] == LEAF_SIDE - 1 && (axis != 1 || l[2] < LEAF_SIDE - 1)
    })
}
