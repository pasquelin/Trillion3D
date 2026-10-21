//! The indexed binary heap every queue of the compiler and the codec pops from: ids under a count,
//! each with an `f32` key, each id's slot kept so its key is updated or the id removed in place,
//! each id in it at most once.
//!
//! The order among equal keys is part of what the callers build, so it is fixed by the rules
//! alone, the same on every run: a sift up moves an entry past its parent only when its key comes
//! strictly first (`Order::before`), and a sift down moves it to the child `Order::sink` names,
//! by the comparisons each queue was built on — a NaN key, which comes before nothing, lands where
//! those comparisons put it. Each queue keeps its own rule:
//!
//! - `LeastRightUnlessLeftLess`: the least key on top; a sift down takes the right child unless the
//!   left one is strictly less, then sinks if it is strictly less than the entry (the cluster DAG's
//!   simplifier);
//! - `Greatest`: the greatest key on top, the left child on a tie (the partition's gains, whole
//!   numbers, never NaN);
//! - `LeastRisingOnTie`: the least key on top, a sift up moving an entry past every parent its key
//!   does not exceed, a sift down weighing the left child against the entry, then the right one
//!   against the lesser of the two, the left kept on a tie, an updated entry rising only when its
//!   key comes strictly before its parent's (the approximated shell's simplifier, the patches
//!   unwrap's front propagations and the atlas's hole infill).
//!
//! A pop fills the top with the last entry and sinks it; a removal fills the slot with the last
//! entry and sinks it when the key removed comes strictly first, else raises it. A sift moves the
//! entry through a hole instead of swapping at each step: the same comparisons, so the same heap.
use std::marker::PhantomData;

/// The slot of an id the heap does not hold.
const OUT: u32 = u32::MAX;

/// Which of two keys comes first, and where a sift down moves an entry.
pub trait Order {
    /// Whether `a` comes strictly before `b`.
    fn before(a: f32, b: f32) -> bool;
    /// Where a sift down moves an entry of `key` whose children hold `left` and, when there is
    /// one, `right`: `Some(0)` to the left child, `Some(1)` to the right one, `None` nowhere.
    fn sink(key: f32, left: f32, right: Option<f32>) -> Option<usize>;
    /// Whether an entry given `key` in place of `old` rises rather than sinks, `parent` the key of
    /// the entry above it, none at the top: by default when the new key comes before the old.
    fn rises(key: f32, old: f32, _parent: Option<f32>) -> bool {
        Self::before(key, old)
    }
}

/// The least key's sift down: the left child when strictly less than the entry, then the right
/// one when strictly less than that — or than the entry, the left staying.
fn least_sink(key: f32, left: f32, right: Option<f32>) -> Option<usize> {
    let left_sinks = left < key;
    let right_sinks = right.is_some_and(|right| {
        if left_sinks {
            right < left
        } else {
            right < key
        }
    });
    if right_sinks {
        Some(1)
    } else {
        left_sinks.then_some(0)
    }
}

pub struct LeastRightUnlessLeftLess;
impl Order for LeastRightUnlessLeftLess {
    fn before(a: f32, b: f32) -> bool {
        a < b
    }
    fn sink(key: f32, left: f32, right: Option<f32>) -> Option<usize> {
        let (child, least) = match right {
            Some(right) if !(left < right) => (1, right),
            _ => (0, left),
        };
        (least < key).then_some(child)
    }
}

pub struct Greatest;
impl Order for Greatest {
    fn before(a: f32, b: f32) -> bool {
        a > b
    }
    fn sink(key: f32, left: f32, right: Option<f32>) -> Option<usize> {
        let (child, most) = match right {
            Some(right) if right > left => (1, right),
            _ => (0, left),
        };
        (most > key).then_some(child)
    }
}

pub struct LeastRisingOnTie;
impl Order for LeastRisingOnTie {
    fn before(a: f32, b: f32) -> bool {
        !(b < a)
    }
    fn sink(key: f32, left: f32, right: Option<f32>) -> Option<usize> {
        least_sink(key, left, right)
    }
    fn rises(key: f32, _old: f32, parent: Option<f32>) -> bool {
        parent.is_some_and(|parent| key < parent)
    }
}

pub struct IndexedHeap<O: Order> {
    /// The heap: ids, an entry's key never after its children's.
    order: Vec<u32>,
    /// Each id's key, kept once it leaves.
    keys: Vec<f32>,
    /// Each id's slot in `order`, `OUT` when not held.
    slots: Vec<u32>,
    rule: PhantomData<O>,
}

impl<O: Order> Default for IndexedHeap<O> {
    fn default() -> Self {
        Self::new(0)
    }
}

impl<O: Order> IndexedHeap<O> {
    /// An empty heap for the ids under `count`; an id past it grows the heap's tables.
    pub fn new(count: usize) -> Self {
        Self {
            order: Vec::with_capacity(count),
            keys: vec![0.0; count],
            slots: vec![OUT; count],
            rule: PhantomData,
        }
    }

    pub fn contains(&self, id: u32) -> bool {
        self.slots.get(id as usize).is_some_and(|&s| s != OUT)
    }

    /// `id`'s key, the last it was given.
    pub fn key(&self, id: u32) -> f32 {
        self.keys[id as usize]
    }

    /// The id on top, left in place.
    pub fn top(&self) -> Option<u32> {
        self.order.first().copied()
    }

    /// The key on top and its id, left in place.
    pub fn peek(&self) -> Option<(f32, u32)> {
        self.top().map(|id| (self.keys[id as usize], id))
    }

    /// Leaves every id out.
    pub fn reset(&mut self) {
        for &id in &self.order {
            self.slots[id as usize] = OUT;
        }
        self.order.clear();
    }

    /// `id`, which the heap does not hold, put in with `key`.
    pub fn insert(&mut self, id: u32, key: f32) {
        let i = id as usize;
        if i >= self.slots.len() {
            self.slots.resize(i + 1, OUT);
            self.keys.resize(i + 1, 0.0);
        }
        self.keys[i] = key;
        self.order.push(id);
        self.up(self.order.len() - 1);
    }

    /// `id`, which the heap holds, given `key`: raised or sunk as `Order::rises` says.
    pub fn update(&mut self, id: u32, key: f32) {
        let old = self.keys[id as usize];
        let at = self.slots[id as usize] as usize;
        self.keys[id as usize] = key;
        let parent = (at > 0).then(|| self.keys[self.order[(at - 1) / 2] as usize]);
        if O::rises(key, old, parent) {
            self.up(at);
        } else {
            self.down(at);
        }
    }

    /// `id` given `key`, put in when the heap does not hold it.
    pub fn set(&mut self, id: u32, key: f32) {
        if self.contains(id) {
            self.update(id, key);
        } else {
            self.insert(id, key);
        }
    }

    /// The id on top, taken out: the last entry fills the top and sinks.
    pub fn pop(&mut self) -> Option<u32> {
        let top = self.top()?;
        if self.take_out(0).is_some() {
            self.down(0);
        }
        Some(top)
    }

    /// `id` taken out when the heap holds it: the last entry fills its slot, then sinks when the
    /// key removed comes strictly before its own, else rises.
    pub fn remove(&mut self, id: u32) {
        if !self.contains(id) {
            return;
        }
        let at = self.slots[id as usize] as usize;
        if let Some(last) = self.take_out(at) {
            if O::before(self.keys[id as usize], self.keys[last as usize]) {
                self.down(at);
            } else {
                self.up(at);
            }
        }
    }

    /// The entry at `at` taken out and the last entry put in its slot, unless it was the last:
    /// that entry, to sift.
    fn take_out(&mut self, at: usize) -> Option<u32> {
        let gone = self.order[at];
        self.slots[gone as usize] = OUT;
        let last = self.order.pop().expect("an entry at that slot");
        (at < self.order.len()).then(|| {
            self.place(at, last);
            last
        })
    }

    fn up(&mut self, mut at: usize) {
        let id = self.order[at];
        let key = self.keys[id as usize];
        while at > 0 {
            let parent = (at - 1) / 2;
            if !O::before(key, self.keys[self.order[parent] as usize]) {
                break;
            }
            self.place(at, self.order[parent]);
            at = parent;
        }
        self.place(at, id);
    }

    fn down(&mut self, mut at: usize) {
        let id = self.order[at];
        let key = self.keys[id as usize];
        let n = self.order.len();
        loop {
            let left = 2 * at + 1;
            if left >= n {
                break;
            }
            let key_at = |slot: usize| self.keys[self.order[slot] as usize];
            let right = (left + 1 < n).then(|| key_at(left + 1));
            let Some(side) = O::sink(key, key_at(left), right) else {
                break;
            };
            let child = left + side;
            self.place(at, self.order[child]);
            at = child;
        }
        self.place(at, id);
    }

    fn place(&mut self, at: usize, id: u32) {
        self.order[at] = id;
        self.slots[id as usize] = at as u32;
    }
}
