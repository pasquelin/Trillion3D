//! The union of two level sets (`union` of `field`), OpenVDB's, top-down, the second tree's
//! nodes taken rather than copied. A tile is inside below zero, outside above it, neither at zero
//! or NaN.
//!
//! The root first (`roots`): its tiles of the background erased; each key's tile side taken from
//! the first tree, or from the second where the first has none or where the first's is outside
//! and the second's inside; the inside keys made tiles of `−background`, replacing a child of the
//! first; each child of the second taken where the first holds neither a child nor an inside
//! tile, its background values changed to the first's (`rebase_table`); the outside keys with no
//! child made tiles of `background`; the background tiles erased again. Where both hold a child,
//! the step goes on below (`below`).
//!
//! An upper node, then a lower node, both trees hold (`table`): each entry where the second holds
//! an inside tile and the first no inside tile becomes an inside tile; each child of the second
//! is taken where the first holds an outside tile, rebased, left where it holds an inside one,
//! and met — the step goes on below it — where it holds a child (or a tile of zero). A leaf both
//! hold takes each of the second's voxels whose value is less, with its active state.
use super::super::tree::{Coord, Leaf, Lower, Slot, Tree, LEAF_SIZE};
use super::collapse_tiles::drop_background_tiles;
use super::near;
use std::collections::{BTreeMap, BTreeSet};

/// The side of the surface a tile lies on.
#[derive(Clone, Copy, PartialEq)]
enum Side {
    Inside,
    Outside,
    Neither,
}

/// The side of a tile of value `value`.
fn side(value: f32) -> Side {
    if value < 0.0 {
        Side::Inside
    } else if value > 0.0 {
        Side::Outside
    } else {
        Side::Neither
    }
}

/// The root's step of `a` made the union of `a` and `b`; whether a child of `b` met one of `a`.
pub(super) fn roots(a: &mut Tree<f32>, b: &mut Tree<f32>) -> bool {
    let (background, theirs) = (a.background, b.background);
    drop_background_tiles(a);
    let mut tiles: BTreeMap<Coord, Side> =
        tiles_of(a).map(|(key, value)| (key, side(value))).collect();
    for (key, value) in tiles_of(b) {
        let given = side(value);
        tiles
            .entry(key)
            .and_modify(|held| {
                if *held == Side::Outside && given == Side::Inside {
                    *held = given;
                }
            })
            .or_insert(given);
    }
    for (key, _) in tiles.iter().filter(|(_, held)| **held == Side::Inside) {
        a.root.insert(*key, Slot::Tile(-background));
    }
    let mut children: BTreeSet<Coord> = a
        .root
        .iter()
        .filter(|(_, entry)| matches!(entry, Slot::Child(_)))
        .map(|(key, _)| *key)
        .collect();
    let mut met = false;
    for (key, entry) in b.root.iter_mut() {
        if !matches!(entry, Slot::Child(_)) {
            continue;
        }
        if children.contains(key) {
            met = true;
            continue;
        }
        if tiles.get(key) == Some(&Side::Inside) {
            continue;
        }
        if let Slot::Child(mut upper) = std::mem::replace(entry, Slot::Tile(theirs)) {
            rebase_table(&mut upper.slots, theirs, background, rebase_lower);
            a.root.insert(*key, Slot::Child(upper));
            children.insert(*key);
        }
    }
    for (key, _) in tiles.iter().filter(|(_, held)| **held == Side::Outside) {
        if !children.contains(key) {
            a.root.insert(*key, Slot::Tile(background));
        }
    }
    drop_background_tiles(a);
    met
}

/// The steps below the root: each upper node of `a` with a child of `b` at its key, each lower
/// node below an upper node whose step met a child, each leaf below a lower node whose did.
pub(super) fn below(a: &mut Tree<f32>, b: &mut Tree<f32>) {
    let (background, theirs) = (a.background, b.background);
    for (key, entry) in a.root.iter_mut() {
        let Slot::Child(upper) = entry else { continue };
        let Some(Slot::Child(other_upper)) = b.root.get_mut(key) else {
            continue;
        };
        if !table(
            &mut upper.slots,
            &mut other_upper.slots,
            background,
            theirs,
            rebase_lower,
        ) {
            continue;
        }
        for (slot, other) in upper.slots.iter_mut().zip(other_upper.slots.iter_mut()) {
            let Slot::Child(lower) = slot else { continue };
            let Slot::Child(other_lower) = other else {
                continue;
            };
            if !table(
                &mut lower.slots,
                &mut other_lower.slots,
                background,
                theirs,
                rebase_leaf,
            ) {
                continue;
            }
            for (slot, other) in lower.slots.iter_mut().zip(other_lower.slots.iter()) {
                let Slot::Child(leaf) = slot else { continue };
                if let Slot::Child(other_leaf) = other {
                    take_lesser(leaf, other_leaf);
                }
            }
        }
    }
}

/// A node's step: `mine` and `theirs` its table in `a` and in `b`, `rebase` changing a taken
/// child's background values from `their_background` to `background`; whether a child of `b`
/// met one of `a`.
fn table<C>(
    mine: &mut [Slot<C, f32>],
    theirs: &mut [Slot<C, f32>],
    background: f32,
    their_background: f32,
    rebase: impl Fn(&mut C, f32, f32),
) -> bool {
    let mut met = false;
    for (slot, other) in mine.iter_mut().zip(theirs.iter_mut()) {
        let held = match *slot {
            Slot::Tile(value) => side(value),
            Slot::Child(_) => Side::Neither,
        };
        match *other {
            Slot::Tile(value) => {
                if held != Side::Inside && value < 0.0 {
                    *slot = Slot::Tile(-background);
                }
            }
            // Their child under an inside tile of ours stays with `b`, which nothing reads again:
            // OpenVDB turns it into an outside tile of `b`, unread as well.
            Slot::Child(_) if held == Side::Inside => {}
            Slot::Child(_) if held == Side::Outside => {
                let taken = std::mem::replace(other, Slot::Tile(their_background));
                if let Slot::Child(mut child) = taken {
                    rebase(&mut *child, their_background, background);
                    *slot = Slot::Child(child);
                }
            }
            Slot::Child(_) => met = true,
        }
    }
    met
}

/// The voxels of `theirs` whose value is less than `leaf`'s taken, with their active state.
fn take_lesser(leaf: &mut Leaf<f32>, theirs: &Leaf<f32>) {
    for pos in 0..LEAF_SIZE {
        let value = theirs.values[pos];
        if value < leaf.values[pos] {
            leaf.values[pos] = value;
            leaf.set_on(pos, theirs.is_on(pos));
        }
    }
}

/// The root's tiles of `tree`, by key.
fn tiles_of(tree: &Tree<f32>) -> impl Iterator<Item = (Coord, f32)> + '_ {
    tree.root.iter().filter_map(|(key, entry)| match entry {
        Slot::Tile(value) => Some((*key, *value)),
        Slot::Child(_) => None,
    })
}

/// A lower node's background values changed from `old` to `new`, its leaves' too.
fn rebase_lower(lower: &mut Lower<f32>, old: f32, new: f32) {
    rebase_table(&mut lower.slots, old, new, rebase_leaf);
}

/// A table's tiles of `old` made `new`, of `−old` made `−new` (within `10⁻⁸`), each child
/// rebased by `child`; nothing when `old` and `new` are the same.
fn rebase_table<C>(
    slots: &mut [Slot<C, f32>],
    old: f32,
    new: f32,
    child: impl Fn(&mut C, f32, f32),
) {
    if old == new {
        return;
    }
    for slot in slots.iter_mut() {
        match slot {
            Slot::Child(node) => child(&mut **node, old, new),
            Slot::Tile(value) => rebase_value(value, old, new),
        }
    }
}

/// A leaf's inactive values of `old` made `new`, of `−old` made `−new`.
fn rebase_leaf(leaf: &mut Leaf<f32>, old: f32, new: f32) {
    if old == new {
        return;
    }
    for pos in 0..LEAF_SIZE {
        if !leaf.is_on(pos) {
            rebase_value(&mut leaf.values[pos], old, new);
        }
    }
}

/// `value` made `new` where it is `old`, `−new` where it is `−old`, within `10⁻⁸`.
fn rebase_value(value: &mut f32, old: f32, new: f32) {
    if near(*value, old) {
        *value = new;
    } else if near(*value, -old) {
        *value = -new;
    }
}
