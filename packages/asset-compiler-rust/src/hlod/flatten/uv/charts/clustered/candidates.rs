//! The candidates each chart keeps: the neighbouring faces outside every chart that may join it,
//! each with the cost `cost` weighs, in a list sorted by decreasing cost so the cheapest is last
//! and taken first (`CostList`). The same list, bounded, also keeps a chart's best-fitting faces
//! when its seed is moved among them.
//!
//! A chart's list is rebuilt whole after every face it takes: per edge of its faces, the free face
//! across it joins the list at its cost, unless the chart refused that face's region before or the
//! face may never join. A face across several edges is listed once per edge, its cost weighed once
//! per rebuild, since nothing the cost reads changes during one; the per-face and per-region marks
//! that tell this are stamped with the rebuild's count, so no rebuild has to clear them.
use super::super::mesh::NONE;
use super::{Cluster, Growth};
use std::cmp::Ordering;

/// Faces with their costs, sorted by decreasing cost so the cheapest is last. A face cheaper than
/// the last is appended; any other goes before the first entry it costs more than, ties after the
/// earlier entries, and then the costliest entry is dropped if the list holds more than its
/// bound (an appended face never drops one).
pub(super) struct CostList {
    bound: usize,
    entries: Vec<(f32, usize)>,
}

impl CostList {
    pub(super) fn new(bound: usize) -> CostList {
        CostList {
            bound,
            entries: Vec::new(),
        }
    }

    pub(super) fn push(&mut self, cost: f32, face: usize) {
        let cheapest = self.entries.last().is_none_or(|&(last, _)| cost < last);
        if cheapest {
            self.entries.push((cost, face));
            return;
        }
        let at = (self.entries.iter())
            .position(|&(entry, _)| entry < cost)
            .unwrap_or(self.entries.len());
        self.entries.insert(at, (cost, face));
        if self.entries.len() > self.bound {
            self.entries.remove(0);
        }
    }

    /// The unbounded list made `entries` (of no NaN cost), in the order pushing them one by one
    /// leaves: by decreasing cost, ties in the order given.
    fn refill(&mut self, mut entries: Vec<(f32, usize)>) {
        entries.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal));
        self.entries = entries;
    }

    pub(super) fn peek(&self) -> Option<(f32, usize)> {
        self.entries.last().copied()
    }

    pub(super) fn pop(&mut self) -> Option<usize> {
        self.entries.pop().map(|(_, face)| face)
    }
}

impl Growth<'_> {
    /// The chart's candidates rebuilt: per edge of its faces, the free face across it unless the
    /// chart refused its region, at its cost when it may join. A face across several edges is
    /// listed once per edge, its cost weighed once: nothing it reads changes meanwhile.
    pub(super) fn rebuild_candidates(&mut self, chart: &mut Cluster) {
        let (surface, planar) = (self.surface, self.planar);
        self.rebuild += 1;
        let stamp = self.rebuild;
        for &region in &chart.failed_regions {
            self.refused[region] = stamp;
        }
        let mut entries = std::mem::take(&mut chart.candidates.entries);
        entries.clear();
        for &f in &chart.faces {
            for edge in f * 3..f * 3 + 3 {
                let other = surface.mesh.face_across(edge);
                if other == NONE
                    || self.in_chart[other]
                    || self.refused[planar.region[other]] == stamp
                {
                    continue;
                }
                if self.weighed[other].0 != stamp {
                    self.weighed[other] = (stamp, self.cost(chart, other));
                }
                let cost = self.weighed[other].1;
                if cost < f32::MAX {
                    entries.push((cost, other));
                }
            }
        }
        chart.candidates.refill(entries);
    }
}
