//! The signs of the active voxels filled into the inactive voxels and the tiles (step 5 of
//! `field`), bottom-up — every leaf, then every lower node, then every upper node, then the root
//! —, each from what it holds, its children already filled: an inactive entry takes the outside
//! value, or the inside one when it is inside.
//!
//! A leaf or a node is walked in table order, `x` slowest (`walk`); the sign carried is that of
//! its first decided entry — a leaf's first active voxel, a node's first child by its first value
//! —, then at each row's and each line's start, and at each entry, that of the entry where it is
//! decided — an active voxel, or a child by its last value, as OpenVDB reads it —; an undecided
//! entry takes the sign carried. A leaf with no active voxel, or a node with no child, takes the
//! sign of its first value everywhere. The root then fills with inside tiles the gaps along `z`
//! between two consecutive upper nodes both inside where they meet, and takes the outside value
//! as background.
use super::super::tree::{
    Coord, Leaf, Lower, Slot, Tree, LEAF_SIDE, LEAF_SIZE, LOWER_SPAN, UPPER_SPAN,
};
use rayon::prelude::*;
use trillion3d_math::scalar::not_below;

/// `tree`'s inactive voxels and tiles set to `|outside|` or `−|inside|` by the signs of its active
/// voxels, its background to `|outside|`.
pub(super) fn fill_signs(tree: &mut Tree<f32>, outside: f32, inside: f32) {
    let (outside, inside) = (outside.abs(), -inside.abs());
    let pick = move |negative: bool| if negative { inside } else { outside };
    tree.leaves_mut()
        .into_par_iter()
        .for_each(|leaf| fill_leaf(leaf, pick));
    let (lower, upper) = (
        (LOWER_SPAN / LEAF_SIDE) as usize,
        (UPPER_SPAN / LOWER_SPAN) as usize,
    );
    for entry in tree.root.values_mut() {
        let Slot::Child(node) = entry else { continue };
        for slot in node.slots.iter_mut() {
            if let Slot::Child(child) = slot {
                let first = |leaf: &Leaf<f32>| leaf.values[0];
                let last = |leaf: &Leaf<f32>| leaf.values[LEAF_SIZE - 1];
                fill_table(&mut child.slots, lower, first, last, pick);
            }
        }
        fill_table(
            &mut node.slots,
            upper,
            Lower::first_value,
            Lower::last_value,
            pick,
        );
    }
    fill_root(tree, inside);
    tree.background = outside;
}

/// A leaf's inactive voxels filled by the signs of its active ones.
fn fill_leaf(leaf: &mut Leaf<f32>, pick: impl Fn(bool) -> f32) {
    let Some(first) = leaf.active().next() else {
        let value = pick(leaf.values[0] < 0.0);
        leaf.values.fill(value);
        return;
    };
    let signs: [Option<bool>; LEAF_SIZE] =
        std::array::from_fn(|pos| leaf.is_on(pos).then_some(leaf.values[pos] < 0.0));
    let start = leaf.values[first] < 0.0;
    walk(&signs, LEAF_SIDE as usize, start, |pos, negative| {
        leaf.values[pos] = pick(negative)
    });
}

/// A node's tiles, a table `side` children a side, filled by the signs of its children: `first`
/// and `last` read a child's first and last values.
fn fill_table<C>(
    slots: &mut [Slot<C, f32>],
    side: usize,
    first: impl Fn(&C) -> f32,
    last: impl Fn(&C) -> f32,
    pick: impl Fn(bool) -> f32,
) {
    let start = slots.iter().find_map(child_of).map(|c| first(c) < 0.0);
    let Some(start) = start else {
        let value = pick(matches!(slots[0], Slot::Tile(v) if v < 0.0));
        slots.iter_mut().for_each(|slot| *slot = Slot::Tile(value));
        return;
    };
    let signs: Vec<Option<bool>> = slots
        .iter()
        .map(|slot| child_of(slot).map(|c| last(c) < 0.0))
        .collect();
    walk(&signs, side, start, |pos, negative| {
        slots[pos] = Slot::Tile(pick(negative))
    });
}

/// The child an entry holds, if it holds one.
fn child_of<C>(slot: &Slot<C, f32>) -> Option<&C> {
    match slot {
        Slot::Child(child) => Some(&**child),
        Slot::Tile(_) => None,
    }
}

/// A `side`³ table walked in order, `x` slowest, from the sign `start`: the sign carried taken
/// from each decided entry (`Some`) at a row's start, at a line's start and along the line, and
/// given to each undecided one (`fill`).
fn walk(signs: &[Option<bool>], side: usize, start: bool, mut fill: impl FnMut(usize, bool)) {
    let mut row = start;
    for x in 0..side {
        let x00 = x * side * side;
        if let Some(sign) = signs[x00] {
            row = sign;
        }
        let mut line = row;
        for y in 0..side {
            let xy0 = x00 + y * side;
            if let Some(sign) = signs[xy0] {
                line = sign;
            }
            let mut carried = line;
            for (xyz, &state) in signs.iter().enumerate().skip(xy0).take(side) {
                match state {
                    Some(sign) => carried = sign,
                    None => fill(xyz, carried),
                }
            }
        }
    }
}

/// The root's gaps along `z` between consecutive upper nodes, the first's last value and the
/// second's first both negative, filled with tiles of `inside`.
fn fill_root(tree: &mut Tree<f32>, inside: f32) {
    let children: Vec<(Coord, f32, f32)> = tree
        .root
        .iter()
        .filter_map(|(key, entry)| match entry {
            Slot::Child(node) => Some((*key, node.first_value(), node.last_value())),
            Slot::Tile(_) => None,
        })
        .collect();
    for pair in children.windows(2) {
        let ((a, _, a_last), (b, b_first, _)) = (pair[0], pair[1]);
        if a[0] != b[0] || a[1] != b[1] || b[2] - a[2] == UPPER_SPAN {
            continue;
        }
        if not_below(a_last, 0.0) || not_below(b_first, 0.0) {
            continue;
        }
        let mut z = a[2] + UPPER_SPAN;
        while z != b[2] {
            tree.root.insert([a[0], a[1], z], Slot::Tile(inside));
            z += UPPER_SPAN;
        }
    }
}
