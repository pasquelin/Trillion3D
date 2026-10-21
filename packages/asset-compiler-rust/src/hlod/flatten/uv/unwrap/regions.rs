//! Regions of a mesh's triangles and which border which, as the patches and the islands merge
//! them:
//!
//! - each region's neighbours listed in the order its triangles, in turn, meet them across their
//!   sides (`Regions::of`);
//! - a region merged into a neighbour (`merge`): its triangles appended to the neighbour's, its
//!   neighbours handed over — one the neighbour borders already keeps its place in each list,
//!   another takes the merged region's place in its own list and joins the end of the neighbour's;
//! - the small regions merged into a neighbour, pass after pass (`merge_small`);
//! - a triangle whose other sides all border one same other region moved into it, round after
//!   round, each region's triangles then listed in order (`optimize_borders`).
use crate::hlod::flatten::mesh::NONE;
use crate::hlod::flatten::sort::unstable_sort;

/// A region: its triangles, its neighbours and whether it still stands.
struct Region {
    triangles: Vec<usize>,
    neighbours: Vec<usize>,
    valid: bool,
}

/// The regions of a mesh and, per triangle of it, the triangles across its sides and its region.
pub(super) struct Regions<'a> {
    regions: Vec<Region>,
    region_of: Vec<usize>,
    across: &'a [[usize; 3]],
}

impl<'a> Regions<'a> {
    /// The regions `sets` of a mesh whose triangles have the triangles `across` their sides, each
    /// region's neighbours listed (module doc).
    pub(super) fn of(across: &'a [[usize; 3]], sets: Vec<Vec<usize>>) -> Self {
        let mut region_of = vec![NONE; across.len()];
        for (k, set) in sets.iter().enumerate() {
            for &t in set {
                region_of[t] = k;
            }
        }
        let regions = (sets.into_iter().enumerate())
            .map(|(k, triangles)| {
                let mut neighbours = Vec::new();
                for &t in &triangles {
                    for n in across[t] {
                        let other = if n == NONE { NONE } else { region_of[n] };
                        if other != NONE && other != k && !neighbours.contains(&other) {
                            neighbours.push(other);
                        }
                    }
                }
                Region {
                    triangles,
                    neighbours,
                    valid: true,
                }
            })
            .collect();
        Self {
            regions,
            region_of,
            across,
        }
    }

    /// How many regions there were, those merged away among them.
    pub(super) fn count(&self) -> usize {
        self.regions.len()
    }

    /// Whether region `k` still stands.
    pub(super) fn is_region(&self, k: usize) -> bool {
        self.regions.get(k).is_some_and(|r| r.valid)
    }

    /// Region `k`'s triangles.
    pub(super) fn triangles(&self, k: usize) -> &[usize] {
        &self.regions[k].triangles
    }

    /// Region `k`'s neighbours.
    pub(super) fn neighbours(&self, k: usize) -> &[usize] {
        &self.regions[k].neighbours
    }

    /// The standing regions' triangles, in the regions' order.
    pub(super) fn into_sets(self) -> Vec<Vec<usize>> {
        (self.regions.into_iter())
            .filter(|r| r.valid)
            .map(|r| r.triangles)
            .collect()
    }

    /// Region `gone` merged into its neighbour `into` (module doc); `false` when they do not
    /// border.
    pub(super) fn merge(&mut self, gone: usize, into: usize) -> bool {
        let borders = self.is_region(gone) && self.neighbours(gone).contains(&into);
        if !borders || !self.is_region(into) {
            return false;
        }
        let moved = std::mem::take(&mut self.regions[gone].triangles);
        for &t in &moved {
            self.region_of[t] = into;
        }
        self.regions[into].triangles.extend(moved);
        self.regions[gone].valid = false;
        self.regions[into].neighbours.retain(|&n| n != gone);
        for other in std::mem::take(&mut self.regions[gone].neighbours) {
            if other == into {
                continue;
            }
            let Some(at) = (self.regions[other].neighbours.iter()).position(|&n| n == gone) else {
                continue;
            };
            if !self.regions[into].neighbours.contains(&other) {
                self.regions[into].neighbours.push(other);
            }
            let list = &mut self.regions[other].neighbours;
            match list.contains(&into) {
                true => {
                    list.remove(at);
                }
                false => list[at] = into,
            }
        }
        true
    }

    /// The regions of at most `threshold` triangles merged (`merge_small_pass`), the size passed
    /// from one up to the threshold, then pass after pass at the threshold while one merges;
    /// whether a pass ran below it or merged.
    pub(super) fn merge_small(&mut self, threshold: usize) -> bool {
        let mut merged = false;
        let mut size = 1;
        while size < threshold || self.merge_small_pass(size) {
            merged = true;
            size = (size + 1).min(threshold);
        }
        merged
    }

    /// One pass: the standing regions of at most `size` triangles, by triangle count
    /// (`unstable_sort`), each still that small merged into the first of its neighbours ranked by
    /// whether the region holds more triangles than it, the sort's own order among equals.
    fn merge_small_pass(&mut self, size: usize) -> bool {
        let mut small: Vec<usize> = (0..self.count())
            .filter(|&k| self.is_region(k) && self.triangles(k).len() <= size)
            .collect();
        unstable_sort(&mut small, |&a, &b| {
            self.triangles(a).len() < self.triangles(b).len()
        });
        let mut merged = false;
        for k in small {
            if !self.is_region(k) || self.triangles(k).len() > size {
                continue;
            }
            let count = self.triangles(k).len();
            let mut matches: Vec<(f32, usize)> = (self.neighbours(k).iter())
                .map(|&n| (f32::from(u8::from(count > self.triangles(n).len())), n))
                .collect();
            if matches.is_empty() {
                continue;
            }
            unstable_sort(&mut matches, |a, b| a.0 > b.0);
            merged |= self.merge(k, matches[0].1);
        }
        merged
    }

    /// The region triangle `t` would move into: the one other region all its sides across which
    /// lie in other regions border, when two or three do.
    fn swap_target(&self, t: usize) -> Option<usize> {
        let own = self.region_of[t];
        let others: Vec<usize> = (self.across[t].iter())
            .filter(|&&n| n != NONE)
            .map(|&n| self.region_of[n])
            .filter(|&r| self.is_region(r) && r != own)
            .collect();
        match others[..] {
            [a, b] if a == b => Some(a),
            [a, b, c] if a == b && a == c => Some(a),
            _ => None,
        }
    }

    /// The triangles moved into the region bordering all their other sides, round after round
    /// until none moves or `rounds` are done, each move checked again as it is made; each region's
    /// triangles then listed in order. Whether one moved.
    pub(super) fn optimize_borders(&mut self, rounds: usize) -> bool {
        let mut moved = false;
        for _ in 0..rounds {
            let swaps: Vec<(usize, usize)> = (0..self.region_of.len())
                .filter(|&t| self.region_of[t] != NONE)
                .filter_map(|t| self.swap_target(t).map(|r| (t, r)))
                .collect();
            if swaps.is_empty() {
                break;
            }
            for (t, r) in swaps {
                if self.swap_target(t) == Some(r) {
                    self.region_of[t] = r;
                    moved = true;
                }
            }
        }
        if moved {
            for region in &mut self.regions {
                region.triangles.clear();
            }
            for (t, &k) in self.region_of.iter().enumerate() {
                if k != NONE {
                    self.regions[k].triangles.push(t);
                }
            }
        }
        moved
    }
}
