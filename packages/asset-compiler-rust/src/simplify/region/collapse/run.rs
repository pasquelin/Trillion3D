//! The simplification: every pair weighed and queued by its cost (`trillion3d_math::heap`, the
//! least cost on top, the right child unless the left one is strictly less), then popped and
//! collapsed, cheapest first.
use super::Simplifier;
use crate::simplify::region::quadric;

/// When a simplification stops: once it holds at most `triangles` and has made a collapse costing
/// `error` or more — a squared length of the region's frame, zero for none —, or at `limit`
/// triangles whatever it cost.
#[derive(Clone, Copy)]
pub(crate) struct Stop {
    pub triangles: usize,
    pub error: f32,
    pub limit: usize,
}

impl Simplifier {
    /// Collapses pairs, cheapest first, until `target` triangles are left, then removes triangles
    /// in order down to it, and puts the largest triangle back if none remains; the largest error
    /// made, penalties aside. At least one collapse is made whatever the count.
    ///
    /// A call after the first, with a lower `target`, goes on from where the last one stopped
    /// (`resumable`): the collapses, their order and their errors do not depend on the target,
    /// so it is the run from scratch to that target, bit for bit, without the collapses already
    /// made.
    pub fn simplify(&mut self, target: usize) -> f32 {
        self.simplify_until(Stop {
            triangles: target,
            error: 0.0,
            limit: target,
        })
    }

    /// `simplify` to a `Stop`: the collapses go on past the triangles it asks until their error
    /// reaches the one it asks, and stop at its limit.
    pub fn simplify_until(&mut self, target: Stop) -> f32 {
        let resumed = std::mem::replace(&mut self.started, true);
        if !resumed {
            self.begin();
        }
        // A run from scratch stops at the first collapse that meets the target: a resumed one may
        // already be there.
        if !(resumed && self.met(target, self.max_error)) {
            self.weigh_pending();
            while let Some(pair) = self.heap.top() {
                if self.heap.key(pair) > f32::MAX {
                    break;
                }
                self.heap.pop();
                let [p0, p1] = self.pairs[pair as usize];
                self.pair_hash0.remove(p0, pair);
                self.pair_hash1.remove(p1, pair);
                let error = self.evaluate_merge(p0, p1, true);
                self.max_error = self.max_error.max(error);
                if self.met(target, self.max_error) {
                    break;
                }
                self.weigh_pending();
            }
        }
        let mut tri = 0;
        while !self.met(target, self.max_error) {
            while self.tri_removed[tri] {
                tri += 1;
            }
            self.remove_tri(tri);
        }
        if self.remaining_tris == 0 || self.remaining_verts < 3 {
            let mut max_error = self.max_error;
            self.restore_backup(&mut max_error);
            self.max_error = max_error;
        }
        self.max_error
    }

    /// Whether `simplify` may be called again with a lower target: the triangle kept aside is
    /// still aside, as it is unless a run left no triangle and put it back.
    pub fn resumable(&self) -> bool {
        self.backup.is_some()
    }

    /// The first call's start: every triangle fixed up and measured, the largest kept aside,
    /// every edge's quadric computed, every pair weighed and queued.
    fn begin(&mut self) {
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
        for pair in 0..self.pairs.len() as u32 {
            self.weigh(pair);
        }
    }

    /// Weighs again the pairs the last collapse sent back from the queue.
    fn weigh_pending(&mut self) {
        let reevaluate = std::mem::take(&mut self.reevaluate);
        for &pair in &reevaluate {
            self.weigh(pair);
        }
        self.reevaluate = reevaluate;
        self.reevaluate.clear();
    }

    /// Weighs `pair` and queues it at its cost.
    fn weigh(&mut self, pair: u32) {
        let [p0, p1] = self.pairs[pair as usize];
        let error = self.evaluate_merge(p0, p1, false);
        self.heap.insert(pair, error);
    }

    /// Whether the simplification stops: `target` reached, or no triangle, no vertex or no finite
    /// error left.
    fn met(&self, target: Stop, max_error: f32) -> bool {
        (self.remaining_tris <= target.triangles && max_error >= target.error)
            || self.remaining_tris <= target.limit
            || self.remaining_tris == 0
            || self.remaining_verts == 0
            || max_error >= f32::MAX
    }
}
