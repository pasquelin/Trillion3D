//! The voxels the surface crosses checked against their neighbours (step 3 of `field`), the
//! surface's self-intersections taken out:
//!
//! 1. an active voxel within `BOUNDARY`, not negative, with no negative neighbour is pushed past
//!    the surface, to `BOUNDARY + MARGIN` (`settle`);
//! 2. then an active voxel past `BOUNDARY` with no neighbour within it is made inactive, in both
//!    trees (`drop_lonely`).
//!
//! A voxel's 26 neighbours inside its leaf are read from the leaf, the others from the tree;
//! OpenVDB reads the in-leaf neighbour `(1, 0, −1)` at `(1, 0, 0)`, a quirk ported as it is. Step
//! 1 writes only values that stay non-negative and step 2 changes only active states, so neither
//! changes what its own test reads: each leaf is decided from the field as it was, in parallel.
use super::super::tree::{local, shift, Leaf, Tree, LEAF_SIDE};
use super::{BOUNDARY, MARGIN, NEIGHBOURS};
use rayon::prelude::*;

/// The crossing voxels with no negative neighbour pushed past the surface.
pub(super) fn settle(distance: &mut Tree<f32>) {
    let pushed = picked(distance, |tree, leaf, pos| {
        let value = leaf.values[pos];
        !(value < 0.0 || value > BOUNDARY) && !neighbour(tree, leaf, pos, |v| v < 0.0)
    });
    for (leaf, pushed) in distance.leaves_mut().into_iter().zip(pushed) {
        for pos in pushed {
            leaf.values[pos] = BOUNDARY + MARGIN;
        }
    }
}

/// The voxels past the surface with no neighbour within `BOUNDARY` made inactive, in `distance`
/// and in `closest`.
pub(super) fn drop_lonely(distance: &mut Tree<f32>, closest: &mut Tree<i32>) {
    let lonely = picked(distance, |tree, leaf, pos| {
        leaf.values[pos] > BOUNDARY && !neighbour(tree, leaf, pos, |v| !(v > BOUNDARY))
    });
    for (leaf, lonely) in distance.leaves_mut().into_iter().zip(lonely) {
        let mut indices = closest.leaf_mut(leaf.origin);
        for pos in lonely {
            leaf.set_on(pos, false);
            if let Some(indices) = indices.as_mut() {
                indices.set_on(pos, false);
            }
        }
    }
}

/// The ranks of each leaf's active voxels `pick` accepts, the leaves in parallel and in the
/// tree's order.
fn picked(
    tree: &Tree<f32>,
    pick: impl Fn(&Tree<f32>, &Leaf<f32>, usize) -> bool + Sync,
) -> Vec<Vec<usize>> {
    let leaves: Vec<&Leaf<f32>> = tree.leaves().collect();
    leaves
        .par_iter()
        .map(|&leaf| {
            leaf.active()
                .filter(|&pos| pick(tree, leaf, pos))
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Whether a neighbour of voxel `pos` of `leaf` passes `test`: those inside the leaf read from it
/// (`step`), the others from `tree`.
fn neighbour(tree: &Tree<f32>, leaf: &Leaf<f32>, pos: usize, test: impl Fn(f32) -> bool) -> bool {
    let here = local(pos);
    let inside = NEIGHBOURS.map(|d| (0..3).all(|k| (0..LEAF_SIDE).contains(&(here[k] + d[k]))));
    let voxel = leaf.coord(pos);
    (0..NEIGHBOURS.len()).any(|m| inside[m] && test(leaf.values[pos.wrapping_add_signed(step(m))]))
        || (0..NEIGHBOURS.len()).any(|m| !inside[m] && test(tree.get(shift(voxel, NEIGHBOURS[m]))))
}

/// The rank step to neighbour `m` inside a leaf, `64·x + 8·y + z` — but `(1, 0, 0)`'s for the
/// seventh, `(1, 0, −1)`: OpenVDB's quirk, ported as it is.
fn step(m: usize) -> isize {
    let [x, y, z] = NEIGHBOURS[m].map(|v| v as isize);
    match m {
        6 => 64,
        _ => 64 * x + 8 * y + z,
    }
}
