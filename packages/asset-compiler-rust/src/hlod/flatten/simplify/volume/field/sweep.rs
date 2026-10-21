//! The outside traced (step 2 of `field`), on the squared distances of every voxel of every leaf,
//! active or not: along `z`, then `y`, then `x`, each line of voxels through a chain of linked
//! leaves (`links`) is swept from the chain's first leaf forward, leaf after leaf while each
//! leaf's stretch of the line ends outside, then from its last leaf back the same way; a swept
//! voxel past `BOUNDARY` is made negative, outside, until a voxel within it — the surface — and
//! again after any voxel already negative. What the sweeps leave is spread through the leaves
//! (`spread`).
//!
//! The chains are disjoint and each line of a chain touches its own voxels only, so the order
//! they are swept in changes nothing; they are swept in rank order.
use super::super::tree::{Coord, Leaf, Tree, LEAF_SIDE, LEAF_SIZE, STRIDES};
use super::links::{face, Links, NONE};
use super::spread::spread;
use super::BOUNDARY;

/// `tree`'s outside voxels made negative: the sweeps along each axis, then the spread.
pub(super) fn outside(tree: &mut Tree<f32>) {
    let mut leaves = tree.leaves_mut();
    let origins: Vec<Coord> = leaves.iter().map(|leaf| leaf.origin).collect();
    let links = Links::new(&origins);
    for axis in [2, 1, 0] {
        sweep(&mut leaves, &links, axis);
    }
    spread(&mut leaves, &links);
}

/// Every chain of leaves along `axis` swept, each of its voxel lines forward from the chain's
/// first leaf, then back from its last.
fn sweep(leaves: &mut [&mut Leaf<f32>], links: &Links, axis: usize) {
    let (next, prev) = (&links.next[axis], &links.prev[axis]);
    let step = STRIDES[axis] as isize;
    let back = STRIDES[axis] * (LEAF_SIDE as usize - 1);
    for first in (0..leaves.len()).filter(|&n| prev[n] == NONE) {
        let mut last = first;
        while next[last] != NONE {
            last = next[last];
        }
        for line in face(axis) {
            let mut at = first;
            while at != NONE && sweep_line(&mut leaves[at].values, line, step) {
                at = next[at];
            }
            let mut at = last;
            while at != NONE && sweep_line(&mut leaves[at].values, line + back, -step) {
                at = prev[at];
            }
        }
    }
}

/// The leaf's stretch of a voxel line, from rank `start` by `step`: each voxel past `BOUNDARY`
/// made negative while the line is outside — it is from the start, stops being at a voxel within
/// `BOUNDARY`, and is again at a negative voxel; whether it ends outside.
fn sweep_line(values: &mut [f32; LEAF_SIZE], start: usize, step: isize) -> bool {
    let mut outside = true;
    for i in 0..LEAF_SIDE as isize {
        let value = &mut values[(start as isize + i * step) as usize];
        if *value < 0.0 {
            outside = true;
        } else {
            if !(*value > BOUNDARY) {
                outside = false;
            }
            if outside {
                *value = -*value;
            }
        }
    }
    outside
}
