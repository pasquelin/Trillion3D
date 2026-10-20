//! The queue of candidate pairs: a binary min-heap over pair indices, each keyed by its cost,
//! with every pair's place kept so a pair can be removed or tested in constant time; and the
//! simplification that pops it.
use super::super::quadric;
use super::{Simplifier, NONE};
use crate::qem::solve::CarriedGhost;

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

impl Simplifier {
    /// Collapses pairs, cheapest first, until `target` triangles are left, then removes triangles
    /// in order down to it, and puts the largest triangle back if none remains; the largest error
    /// made, penalties aside. At least one collapse is made whatever the count.
    /// It starts from the ghosts `carried`, in object space, the frame `scale` times it.
    pub fn simplify(&mut self, target: usize, carried: &[CarriedGhost], scale: f32) -> f32 {
        let size = quadric::size(self.m);
        for tri in 0..self.tri_removed.len() {
            self.fix_up_tri(tri);
            if !self.tri_removed[tri] {
                let area = self.tri_quadrics[tri * size + quadric::AREA] as f32;
                self.total_area += area;
                if self.backup.as_ref().is_none_or(|b| area > b.area) {
                    self.capture_backup(tri, area);
                }
            }
        }
        for corner in 0..self.indexes.len() {
            self.calc_edge_quadric(corner);
        }
        self.seed_ghosts(carried, scale);
        self.holed = vec![false; self.pairs.len()];
        for pair in 0..self.pairs.len() as u32 {
            self.weigh(pair);
        }
        let mut max_error = 0.0_f32;
        while let Some(pair) = self.heap.top() {
            let key = self.heap.key(pair);
            if key > f32::MAX {
                break;
            }
            self.heap.pop();
            let [p0, p1] = self.pairs[pair as usize];
            // A hole grows as ghosts are left and the surface around goes: weighed again, the
            // pair goes back if it rose — once per weighing: popped again, it goes at that cost.
            if self.holed[pair as usize] && self.ghosts.any() {
                self.holed[pair as usize] = false;
                let (cost, _) = self.evaluate_merge(p0, p1, false);
                if cost > key {
                    self.heap.add(cost, pair);
                    continue;
                }
            }
            self.pair_hash0.remove(p0, pair);
            self.pair_hash1.remove(p1, pair);
            let (error, _) = self.evaluate_merge(p0, p1, true);
            max_error = max_error.max(error);
            if self.met(target, max_error) {
                break;
            }
            let reevaluate = std::mem::take(&mut self.reevaluate);
            for &pair in &reevaluate {
                self.weigh(pair);
            }
            self.reevaluate = reevaluate;
            self.reevaluate.clear();
        }
        let mut tri = 0;
        while !self.met(target, max_error) {
            while self.tri_removed[tri] {
                tri += 1;
            }
            self.remove_tri(tri);
        }
        if self.remaining_tris == 0 || self.remaining_verts < 3 {
            self.restore_backup(&mut max_error);
            // The triangle put back is listed where it lies.
            let (ghosts, live) = self.ghosts_and_surface();
            ghosts.moved(&live, &[0]);
        }
        max_error
    }

    /// Weighs `pair` and queues it at its cost.
    fn weigh(&mut self, pair: u32) {
        let [p0, p1] = self.pairs[pair as usize];
        let (error, capped) = self.evaluate_merge(p0, p1, false);
        self.heap.add(error, pair);
        self.holed[pair as usize] = capped;
    }

    /// Whether the simplification stops: `target` triangles reached, or no triangle, no vertex
    /// or no finite error left.
    fn met(&self, target: usize, max_error: f32) -> bool {
        self.remaining_tris <= target
            || self.remaining_tris == 0
            || self.remaining_verts == 0
            || max_error >= f32::MAX
    }
}
