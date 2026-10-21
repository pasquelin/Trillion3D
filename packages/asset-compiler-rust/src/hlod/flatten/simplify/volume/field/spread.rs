//! The outside spread through the leaves after the sweeps (step 2 of `field`), in rounds until a
//! round changes no leaf:
//!
//! 1. each leaf changed in the last round — every leaf in the first — spread through itself
//!    (`within`): its voxels past `BOUNDARY` with a negative face neighbour in the leaf made
//!    negative, in rank order, again and again until a pass changes none;
//! 2. each leaf's face voxels past `BOUNDARY` marked where they face a negative voxel of a linked
//!    leaf changed in the last round (`marks`), across any gap; the leaves with a mark are those
//!    changed in this round;
//! 3. if there are any, each marked voxel made negative.
//!
//! Step 1 changes each leaf alone, step 2 only reads, step 3 writes each leaf's own marks: each
//! runs its leaves in parallel.
use super::super::tree::{local, Leaf, LEAF_SIDE, LEAF_SIZE, STRIDES};
use super::links::{face, Links, NONE};
use super::BOUNDARY;
use rayon::prelude::*;

/// A leaf's marked voxels, a bit per voxel by rank.
type Marks = [u64; 8];

/// The outside spread through `leaves`, linked by `links`, until nothing changes.
pub(super) fn spread(leaves: &mut [&mut Leaf<f32>], links: &Links) {
    let mut changed = vec![true; leaves.len()];
    loop {
        leaves
            .par_iter_mut()
            .zip(changed.par_iter())
            .for_each(|(leaf, &again)| {
                if again {
                    within(&mut leaf.values);
                }
            });
        let view: &[&mut Leaf<f32>] = &*leaves;
        let marks: Vec<Marks> = (0..view.len())
            .into_par_iter()
            .map(|n| self::marks(view, links, &changed, n))
            .collect();
        changed = marks
            .iter()
            .map(|m| m.iter().any(|&word| word != 0))
            .collect();
        if !changed.contains(&true) {
            return;
        }
        leaves
            .par_iter_mut()
            .zip(marks.par_iter())
            .for_each(|(leaf, marks)| {
                for pos in (0..LEAF_SIZE).filter(|&pos| marks[pos >> 6] >> (pos & 63) & 1 == 1) {
                    leaf.values[pos] = -leaf.values[pos];
                }
            });
    }
}

/// The outside spread through one leaf: each voxel past `BOUNDARY` with a negative neighbour in
/// the leaf across a face made negative, in rank order, pass after pass while one changes any.
fn within(values: &mut [f32; LEAF_SIZE]) {
    let side = LEAF_SIDE - 1;
    let mut again = true;
    while again {
        again = false;
        for pos in 0..LEAF_SIZE {
            if !(values[pos] > BOUNDARY) {
                continue;
            }
            let [x, y, z] = local(pos);
            let negative = |at: usize| values[at] < 0.0;
            let outside = (z != 0 && negative(pos - 1))
                || (z != side && negative(pos + 1))
                || (y != 0 && negative(pos - 8))
                || (y != side && negative(pos + 8))
                || (x != 0 && negative(pos - 64))
                || (x != side && negative(pos + 64));
            if outside {
                again = true;
                values[pos] = -values[pos];
            }
        }
    }
}

/// Leaf `n`'s face voxels past `BOUNDARY` that face a negative voxel of the linked leaf back,
/// then further, along `z`, `y` and `x`, where that leaf `changed` in the last round.
fn marks(leaves: &[&mut Leaf<f32>], links: &Links, changed: &[bool], n: usize) -> Marks {
    let mut marks = [0u64; 8];
    let mine = &leaves[n].values;
    for axis in [2, 1, 0] {
        let last = STRIDES[axis] * (LEAF_SIDE as usize - 1);
        let sides = [
            (links.prev[axis][n], 0, last),
            (links.next[axis][n], last, 0),
        ];
        for (other, here, there) in sides {
            if other == NONE || !changed[other] {
                continue;
            }
            let theirs = &leaves[other].values;
            for pos in face(axis) {
                if mine[pos + here] > BOUNDARY && theirs[pos + there] < 0.0 {
                    let at = pos + here;
                    marks[at >> 6] |= 1 << (at & 63);
                }
            }
        }
    }
    marks
}
