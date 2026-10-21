//! The tree's inactive children turned into tiles, bottom-up: each lower node's leaves with no
//! active voxel, then each upper node's lower nodes left with no child, then the root's upper
//! nodes left with none — a child's tile valued from its first value. A node only reads its own
//! children, already collapsed, so the nodes go one after another in the tree's order.
//!
//! After the intersecting voxels are taken out (step 3 of `field`) the tiles take the tree's
//! background and those of the root are dropped (`drop_inactive`); for a level set
//! (`prune_level_set`) they take the band's outside or inside value by the sign of the first
//! value, and the root then drops its tiles of the background (`drop_background_tiles`).
use super::super::tree::{Leaf, Lower, Slot, Tree, Upper};
use super::near;

/// Every inactive child of `tree` replaced by a tile of value `tile(its first value)`.
pub(super) fn inactive_children<T: Copy>(tree: &mut Tree<T>, tile: impl Fn(T) -> T) {
    replace(tree.root.values_mut(), |upper: &mut Upper<T>| {
        replace(upper.slots.iter_mut(), |lower: &mut Lower<T>| {
            replace(lower.slots.iter_mut(), |leaf: &mut Leaf<T>| {
                leaf.inactive().then(|| tile(leaf.values[0]))
            });
            lower.inactive().then(|| tile(lower.first_value()))
        });
        upper.inactive().then(|| tile(upper.first_value()))
    });
}

/// Every inactive child of `tree` dropped to a tile of its background, and the root's tiles
/// erased: every entry of the root is a child here — `touch` makes them all —, so the only tiles
/// the root holds are those just made, of the background.
pub(super) fn drop_inactive<T: Copy>(tree: &mut Tree<T>) {
    let background = tree.background;
    inactive_children(tree, |_| background);
    tree.root.retain(|_, entry| matches!(entry, Slot::Child(_)));
}

/// The root's tiles of the tree's background, within `10⁻⁸` (`near`), erased.
pub(super) fn drop_background_tiles(tree: &mut Tree<f32>) {
    let background = tree.background;
    tree.root
        .retain(|_, entry| !matches!(*entry, Slot::Tile(value) if near(value, background)));
}

/// Each child of `slots` that `collapse` gives a value replaced by a tile of that value.
fn replace<'a, C: 'a, T: 'a>(
    slots: impl Iterator<Item = &'a mut Slot<C, T>>,
    mut collapse: impl FnMut(&mut C) -> Option<T>,
) {
    for slot in slots {
        let value = match slot {
            Slot::Child(child) => collapse(&mut **child),
            Slot::Tile(_) => None,
        };
        if let Some(value) = value {
            *slot = Slot::Tile(value);
        }
    }
}
