//! A cluster's identity, which orders every level's new clusters, and so every cluster's
//! neighbours (`levels.rs`): whatever order the reductions end in, the next level reads the same
//! clusters in the same order.
//!
//! - A level-0 cluster: its range of the partition, the rank of its first triangle above the rank
//!   past its last (`of_range`).
//! - A group: its children's identities folded in their order, from zero (`of_group`).
//! - A cluster a group's re-split made: the group's identity hashed with its range of the re-split
//!   (`of_parts`); a group left in one cluster gives it the group's own.
use trillion3d_math::sequence::random::murmur3_64;

/// The identity of the level-0 cluster of the partition's triangles `begin..end`.
pub(super) fn of_range(begin: usize, end: usize) -> u64 {
    (begin as u64) << 32 | end as u64
}

/// The identity of the group of the clusters of `children` identities, in its order.
pub(super) fn of_group(children: impl IntoIterator<Item = u64>) -> u64 {
    (children.into_iter()).fold(0, |group, child| murmur3_64(&[group, child]))
}

/// The identities of the clusters a re-split of group `group` made, of `sizes` triangles each in
/// its order: each the group's with its range of the re-split.
pub(super) fn of_parts(group: u64, sizes: impl IntoIterator<Item = usize>) -> Vec<u64> {
    let mut begin = 0;
    (sizes.into_iter())
        .map(|size| {
            let end = begin + size;
            let identity = murmur3_64(&[group, begin as u64, end as u64]);
            begin = end;
            identity
        })
        .collect()
}
