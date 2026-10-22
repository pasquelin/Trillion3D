//! The greatest-first heap of the charts' queues whose keys are no `f32`: the simplifier's
//! double-precision costs, the geodesic windows' double-precision distances (least first, through
//! `Least`), the merge's face counts and the smoothing's vote counts. The `f32` queues use the
//! shared `IndexedHeap`, whose comparisons are these.
//!
//! Ids under a count, each held at most once, each with its key and its slot. The order among equal
//! keys is part of the result, so the steps are the library's, swap by swap:
//!
//! - an insertion lands last and rises while its key is strictly greater than its parent's;
//! - a sift down swaps an entry with its left child when that one is strictly greater, then with
//!   the right child when it is strictly greater than the greater of the two so far;
//! - a removal swaps the entry with the last one, drops it, then sinks the entry moved into its
//!   slot when that one's key is strictly less than the removed key, else raises it;
//! - a key change sinks the entry when the new key is strictly less than the old one, else raises
//!   it; a change to an id not held does nothing.
use std::cmp::Ordering;
use trillion3d_math::scalar::not_above;

/// The slot of an id not held.
const OUT: u32 = u32::MAX;

/// A key in reverse: the least comes first in a greatest-first heap.
#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Least<T>(pub T);

impl<T: PartialOrd> PartialOrd for Least<T> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        other.0.partial_cmp(&self.0)
    }
}

#[derive(Clone)]
pub(crate) struct Ranked<K> {
    /// The heap: ids, an entry's key never less than its children's.
    order: Vec<u32>,
    /// Each id's key, kept once it leaves.
    keys: Vec<K>,
    /// Each id's slot in `order`, `OUT` when not held.
    slots: Vec<u32>,
}

impl<K: PartialOrd + Copy + Default> Ranked<K> {
    /// An empty heap for the ids under `count`; an id past it grows the tables.
    pub(crate) fn new(count: usize) -> Self {
        Self {
            order: Vec::with_capacity(count),
            keys: vec![K::default(); count],
            slots: vec![OUT; count],
        }
    }

    pub(crate) fn contains(&self, id: u32) -> bool {
        self.slots.get(id as usize).is_some_and(|&s| s != OUT)
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    /// `id`, not held, put in with `key`.
    pub(crate) fn insert(&mut self, id: u32, key: K) {
        let i = id as usize;
        if i >= self.slots.len() {
            self.slots.resize(i + 1, OUT);
            self.keys.resize(i + 1, K::default());
        }
        self.keys[i] = key;
        self.slots[i] = self.order.len() as u32;
        self.order.push(id);
        self.up(self.order.len() - 1);
    }

    /// `id` given `key`; nothing when `id` is not held.
    pub(crate) fn update(&mut self, id: u32, key: K) {
        if !self.contains(id) {
            return;
        }
        let old = self.keys[id as usize];
        self.keys[id as usize] = key;
        let at = self.slots[id as usize] as usize;
        if key < old {
            self.down(at);
        } else {
            self.up(at);
        }
    }

    /// The id on top, taken out.
    pub(crate) fn pop(&mut self) -> Option<u32> {
        let top = *self.order.first()?;
        self.remove_at(0);
        Some(top)
    }

    /// `id` taken out when held.
    pub(crate) fn remove(&mut self, id: u32) {
        if self.contains(id) {
            self.remove_at(self.slots[id as usize] as usize);
        }
    }

    fn remove_at(&mut self, at: usize) {
        let last = self.order.len() - 1;
        self.swap(at, last);
        let gone = self.order.pop().expect("an entry at that slot");
        self.slots[gone as usize] = OUT;
        if at < self.order.len() {
            if self.weight(at) < self.keys[gone as usize] {
                self.down(at);
            } else {
                self.up(at);
            }
        }
    }

    fn weight(&self, at: usize) -> K {
        self.keys[self.order[at] as usize]
    }

    fn swap(&mut self, i: usize, j: usize) {
        if i != j {
            self.order.swap(i, j);
            self.slots[self.order[i] as usize] = i as u32;
            self.slots[self.order[j] as usize] = j as u32;
        }
    }

    fn down(&mut self, mut at: usize) {
        let n = self.order.len();
        while at < n {
            let mut larger = at;
            let mut most = self.weight(at);
            let (left, right) = (2 * at + 1, 2 * at + 2);
            if left < n && self.weight(left) > most {
                larger = left;
                most = self.weight(left);
            }
            if right < n && self.weight(right) > most {
                larger = right;
            }
            if larger == at {
                break;
            }
            self.swap(at, larger);
            at = larger;
        }
    }

    fn up(&mut self, mut at: usize) {
        while at > 0 {
            let parent = (at - 1) >> 1;
            if not_above(self.weight(at), self.weight(parent)) {
                break;
            }
            self.swap(at, parent);
            at = parent;
        }
    }
}
