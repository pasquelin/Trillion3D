//! A leaf of the sparse voxel tree (`Leaf`): an 8³ block of values with a mask of the active ones.
use super::{local, Coord, LEAF_SIZE};

/// An 8³ block of values, `on` its active mask, a bit per voxel by rank.
#[derive(Clone)]
pub(crate) struct Leaf<T> {
    pub origin: Coord,
    pub values: Box<[T; LEAF_SIZE]>,
    pub on: [u64; 8],
}

impl<T: Copy> Leaf<T> {
    /// A leaf at `origin` holding `value` everywhere, every voxel inactive.
    pub(crate) fn filled(origin: Coord, value: T) -> Self {
        Self {
            origin,
            values: Box::new([value; LEAF_SIZE]),
            on: [0; 8],
        }
    }
    pub(crate) fn is_on(&self, pos: usize) -> bool {
        self.on[pos >> 6] >> (pos & 63) & 1 == 1
    }
    pub(crate) fn set_on(&mut self, pos: usize, on: bool) {
        let bit = 1u64 << (pos & 63);
        match on {
            true => self.on[pos >> 6] |= bit,
            false => self.on[pos >> 6] &= !bit,
        }
    }
    /// `value` written at `pos` and made active.
    pub(crate) fn set(&mut self, pos: usize, value: T) {
        self.values[pos] = value;
        self.set_on(pos, true);
    }
    /// Whether no voxel is active.
    pub(crate) fn inactive(&self) -> bool {
        self.on.iter().all(|&w| w == 0)
    }
    /// The ranks of its active voxels, in order.
    pub(crate) fn active(&self) -> impl Iterator<Item = usize> + '_ {
        (0..LEAF_SIZE).filter(|&pos| self.is_on(pos))
    }
    /// The global coordinates of the voxel of rank `pos`.
    pub(crate) fn coord(&self, pos: usize) -> Coord {
        let l = local(pos);
        [0, 1, 2].map(|k| self.origin[k] + l[k])
    }
}
