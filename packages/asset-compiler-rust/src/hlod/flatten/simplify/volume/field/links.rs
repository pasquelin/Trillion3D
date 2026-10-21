//! The leaves' neighbours along each axis, the tracing of the outside reads (step 2 of `field`):
//! for each leaf, by its rank in the tree's order, the nearest leaf on the same line of leaves
//! further along the axis and the nearest one back, across any gap. OpenVDB walks from a leaf a
//! leaf's width at a time while it stays in the box of the leaves holding an active voxel; every
//! leaf holds one here — the voxelization activates each voxel it writes —, so the box holds
//! every leaf, and the leaf the walk meets first is the next one on the line in coordinate order,
//! which a sort finds.
use super::super::tree::{Coord, LEAF_SIDE, STRIDES};

/// No neighbour.
pub(super) const NONE: usize = usize::MAX;

/// Each leaf's nearest leaf further along each axis (`next`) and back (`prev`), by rank, `NONE`
/// where there is none.
pub(super) struct Links {
    pub(super) next: [Vec<usize>; 3],
    pub(super) prev: [Vec<usize>; 3],
}

impl Links {
    /// The links of the leaves of `origins`, given in the tree's order.
    pub(super) fn new(origins: &[Coord]) -> Self {
        let none = || [(); 3].map(|_| vec![NONE; origins.len()]);
        let mut links = Links {
            next: none(),
            prev: none(),
        };
        for axis in 0..3 {
            let [slow, fast] = across(axis);
            let line = |n: usize| [origins[n][slow], origins[n][fast]];
            let mut order: Vec<usize> = (0..origins.len()).collect();
            order.sort_unstable_by_key(|&n| (line(n), origins[n][axis]));
            for pair in order.windows(2) {
                if line(pair[0]) == line(pair[1]) {
                    links.next[axis][pair[0]] = pair[1];
                    links.prev[axis][pair[1]] = pair[0];
                }
            }
        }
        links
    }
}

/// The ranks of a leaf's voxels whose coordinate along `axis` is zero: the two other axes in
/// order, the first slowest — the voxel lines a sweep along `axis` follows, and the face a leaf
/// shows its neighbour back along it.
pub(super) fn face(axis: usize) -> impl Iterator<Item = usize> {
    let [slow, fast] = across(axis);
    let side = LEAF_SIDE as usize;
    (0..side).flat_map(move |a| (0..side).map(move |b| a * STRIDES[slow] + b * STRIDES[fast]))
}

/// The two axes other than `axis`, in order.
fn across(axis: usize) -> [usize; 2] {
    match axis {
        0 => [1, 2],
        1 => [0, 2],
        _ => [0, 1],
    }
}
