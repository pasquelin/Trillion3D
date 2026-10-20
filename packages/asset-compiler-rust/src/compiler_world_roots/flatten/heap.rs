//! The indexed binary min-heap both simplifiers pop their edges from (`simplify.rs`,
//! `proxy_lod/simplifier.rs`): `(key, id)` pairs, each id's slot kept so its key is updated or
//! removed in place, each id in it at most once. A key moves only past a strictly smaller one, so
//! equal keys keep the order they were inserted and sifted in; `RIGHT_ON_TIE` names the child a
//! sift down takes when its two children's keys are equal — the right one, else the left —, the
//! one tie each simplifier settles its own way, so both stay deterministic.

/// The slot of an id the heap does not hold.
const OUT: u32 = u32::MAX;

pub(super) struct Heap<const RIGHT_ON_TIE: bool> {
    heap: Vec<(f32, u32)>,
    at: Vec<u32>,
}

impl<const RIGHT_ON_TIE: bool> Heap<RIGHT_ON_TIE> {
    /// An empty heap for the ids under `count`.
    pub(super) fn new(count: usize) -> Self {
        Heap {
            heap: Vec::with_capacity(count),
            at: vec![OUT; count],
        }
    }

    pub(super) fn contains(&self, id: u32) -> bool {
        self.at[id as usize] != OUT
    }

    /// The least key and its id, left in place.
    pub(super) fn peek(&self) -> Option<(f32, u32)> {
        self.heap.first().copied()
    }

    fn swap(&mut self, i: usize, j: usize) {
        self.heap.swap(i, j);
        self.at[self.heap[i].1 as usize] = i as u32;
        self.at[self.heap[j].1 as usize] = j as u32;
    }

    fn up(&mut self, mut i: usize) {
        while i > 0 {
            let parent = (i - 1) / 2;
            if self.heap[i].0 < self.heap[parent].0 {
                self.swap(i, parent);
                i = parent;
            } else {
                break;
            }
        }
    }

    fn down(&mut self, mut i: usize) {
        loop {
            let (l, r) = (2 * i + 1, 2 * i + 2);
            let mut least = i;
            if l < self.heap.len() && self.heap[l].0 < self.heap[least].0 {
                least = l;
            }
            if r < self.heap.len()
                && (self.heap[r].0 < self.heap[least].0
                    || (RIGHT_ON_TIE && least == l && self.heap[r].0 == self.heap[l].0))
            {
                least = r;
            }
            if least == i {
                break;
            }
            self.swap(i, least);
            i = least;
        }
    }

    pub(super) fn insert(&mut self, id: u32, key: f32) {
        self.heap.push((key, id));
        let i = self.heap.len() - 1;
        self.at[id as usize] = i as u32;
        self.up(i);
    }

    /// `id`, which the heap holds, given `key`.
    pub(super) fn update(&mut self, id: u32, key: f32) {
        let i = self.at[id as usize] as usize;
        let before = self.heap[i].0;
        self.heap[i].0 = key;
        if key < before {
            self.up(i);
        } else {
            self.down(i);
        }
    }

    /// `id` given `key`, inserted when the heap does not hold it.
    pub(super) fn set(&mut self, id: u32, key: f32) {
        if self.contains(id) {
            self.update(id, key);
        } else {
            self.insert(id, key);
        }
    }

    /// The id of the least key, taken out.
    pub(super) fn pop(&mut self) -> Option<u32> {
        let last = self.heap.len().checked_sub(1)?;
        self.swap(0, last);
        let (_, id) = self.heap.pop()?;
        self.at[id as usize] = OUT;
        if !self.heap.is_empty() {
            self.down(0);
        }
        Some(id)
    }

    /// `id` taken out when the heap holds it: the last entry moved into its slot and sifted down
    /// past a key above the one removed, up otherwise.
    pub(super) fn remove(&mut self, id: u32) {
        if !self.contains(id) {
            return;
        }
        let i = self.at[id as usize] as usize;
        let last = self.heap.len() - 1;
        let removed = self.heap[i].0;
        self.swap(i, last);
        self.heap.pop();
        self.at[id as usize] = OUT;
        if i < last {
            if removed < self.heap[i].0 {
                self.down(i);
            } else {
                self.up(i);
            }
        }
    }
}
