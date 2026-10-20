//! The queue of candidate pairs: a binary min-heap over pair indices, each keyed by its cost,
//! with every pair's place kept so a pair can be removed or tested in constant time.
use super::NONE;

#[derive(Default)]
pub(super) struct Heap {
    heap: Vec<u32>,
    keys: Vec<f32>,
    places: Vec<u32>,
}

impl Heap {
    pub fn is_present(&self, index: u32) -> bool {
        self.places.get(index as usize).is_some_and(|&p| p != NONE)
    }
    pub fn key(&self, index: u32) -> f32 {
        self.keys[index as usize]
    }
    /// The index of least key, if any.
    pub fn top(&self) -> Option<u32> {
        self.heap.first().copied()
    }
    pub fn pop(&mut self) {
        let index = self.heap[0];
        let last = self.heap.pop().expect("a heap with a top");
        if !self.heap.is_empty() {
            self.heap[0] = last;
            self.places[last as usize] = 0;
        }
        self.places[index as usize] = NONE;
        if !self.heap.is_empty() {
            self.down(0);
        }
    }
    pub fn add(&mut self, key: f32, index: u32) {
        let i = index as usize;
        if i >= self.places.len() {
            self.places.resize(i + 1, NONE);
            self.keys.resize(i + 1, 0.0);
        }
        let place = self.heap.len() as u32;
        self.heap.push(index);
        self.keys[i] = key;
        self.places[i] = place;
        self.up(place as usize);
    }
    pub fn remove(&mut self, index: u32) {
        if !self.is_present(index) {
            return;
        }
        let key = self.keys[index as usize];
        let place = self.places[index as usize] as usize;
        let last = self.heap.pop().expect("a present index");
        self.places[index as usize] = NONE;
        if place == self.heap.len() {
            return;
        }
        self.heap[place] = last;
        self.places[last as usize] = place as u32;
        if key < self.keys[last as usize] {
            self.down(place);
        } else {
            self.up(place);
        }
    }

    fn up(&mut self, place: usize) {
        let moving = self.heap[place];
        let mut i = place;
        while i > 0 {
            let parent = (i - 1) >> 1;
            if !(self.keys[moving as usize] < self.keys[self.heap[parent] as usize]) {
                break;
            }
            self.heap[i] = self.heap[parent];
            self.places[self.heap[i] as usize] = i as u32;
            i = parent;
        }
        if i != place {
            self.heap[i] = moving;
            self.places[moving as usize] = i as u32;
        }
    }

    fn down(&mut self, place: usize) {
        let moving = self.heap[place];
        let n = self.heap.len();
        let mut i = place;
        loop {
            let left = (i << 1) + 1;
            if left >= n {
                break;
            }
            let right = left + 1;
            let key = |at: usize| self.keys[self.heap[at] as usize];
            let smallest = if right < n && !(key(left) < key(right)) {
                right
            } else {
                left
            };
            if key(smallest) < self.keys[moving as usize] {
                self.heap[i] = self.heap[smallest];
                self.places[self.heap[i] as usize] = i as u32;
                i = smallest;
            } else {
                break;
            }
        }
        if i != place {
            self.heap[i] = moving;
            self.places[moving as usize] = i as u32;
        }
    }
}
