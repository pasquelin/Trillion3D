//! The bisection's queue of vertices by gain (`bisect.rs`): a binary heap over vertex numbers,
//! the greatest gain on top, each vertex's place kept so it can move or leave in place.
//!
//! The order among equal gains is part of the cut, so it is fixed by the rules alone: a vertex
//! climbs past a parent only of a strictly smaller gain, and sinks below the greater of its two
//! children — the left on a tie — only when that child's gain is strictly greater. Gains are kept
//! in `f32`, the precision the cut's ties are decided at.

const NOWHERE: u32 = u32::MAX;

pub(super) struct Gains {
    /// The heap: vertex numbers, a parent's gain no smaller than its children's.
    order: Vec<u32>,
    /// Each vertex's gain while queued.
    gain: Vec<f32>,
    /// Each vertex's place in `order`, `NOWHERE` when not queued.
    place: Vec<u32>,
}

impl Gains {
    pub fn new(vertices: usize) -> Self {
        Self {
            order: Vec::new(),
            gain: vec![0.0; vertices],
            place: vec![NOWHERE; vertices],
        }
    }

    /// Leaves every vertex out.
    pub fn reset(&mut self) {
        for &v in &self.order {
            self.place[v as usize] = NOWHERE;
        }
        self.order.clear();
    }

    pub fn insert(&mut self, v: u32, gain: i64) {
        self.gain[v as usize] = gain as f32;
        self.order.push(v);
        self.climb(self.order.len() - 1);
    }

    /// The vertex of greatest gain, taken out; `None` once empty.
    pub fn pop(&mut self) -> Option<u32> {
        let top = *self.order.first()?;
        self.take_out(0);
        Some(top)
    }

    pub fn remove(&mut self, v: u32) {
        let at = self.place[v as usize] as usize;
        self.take_out(at);
    }

    pub fn update(&mut self, v: u32, gain: i64) {
        let (old, new) = (self.gain[v as usize], gain as f32);
        let at = self.place[v as usize] as usize;
        self.gain[v as usize] = new;
        if new > old {
            self.climb(at);
        } else if new < old {
            self.sink(at);
        }
    }

    /// Takes the vertex at `at` out: the last vertex fills its place, then climbs if it gains
    /// more than the one it replaces, else sinks.
    fn take_out(&mut self, at: usize) {
        let gone = self.order[at];
        self.place[gone as usize] = NOWHERE;
        let last = self.order.pop().expect("queued");
        if at < self.order.len() {
            let rises = self.gain[last as usize] > self.gain[gone as usize];
            self.set(at, last);
            if rises {
                self.climb(at);
            } else {
                self.sink(at);
            }
        }
    }

    fn climb(&mut self, mut at: usize) {
        let v = self.order[at];
        while at > 0 {
            let parent = (at - 1) / 2;
            if self.gain[v as usize] <= self.gain[self.order[parent] as usize] {
                break;
            }
            self.set(at, self.order[parent]);
            at = parent;
        }
        self.set(at, v);
    }

    fn sink(&mut self, mut at: usize) {
        let v = self.order[at];
        let n = self.order.len();
        loop {
            let left = 2 * at + 1;
            if left >= n {
                break;
            }
            let right = left + 1;
            let gain_of = |slot: usize| self.gain[self.order[slot] as usize];
            let child = if right < n && gain_of(right) > gain_of(left) {
                right
            } else {
                left
            };
            if gain_of(child) <= self.gain[v as usize] {
                break;
            }
            self.set(at, self.order[child]);
            at = child;
        }
        self.set(at, v);
    }

    fn set(&mut self, at: usize, v: u32) {
        self.order[at] = v;
        self.place[v as usize] = at as u32;
    }
}
