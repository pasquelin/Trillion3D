//! The fill's polygons nested into solid regions (`solid_regions`), their windings trusted — a
//! polygon of positive signed area an outer loop, any other a hole — and no two holes of one region
//! allowed to overlap:
//!
//! 1. each polygon's size — its signed area made positive — and box; the polygons ordered by size,
//!    largest first, by the one unstable sort the HLOD steps share (`unstable_sort`), equals as it
//!    leaves them;
//! 2. from the largest outer loop down, every smaller hole it holds — its box within the loop's,
//!    every vertex inside the loop and no side crossing it (`holds`) — given to it, a later,
//!    smaller loop that holds it taking it over; unless it overlaps (`overlaps`) a hole, between
//!    the two in size, given to that loop already;
//! 3. each outer loop, in that order, a region with the holes it was left with, in that order. A
//!    hole no outer loop holds fills nothing.
use super::polygon::{holds, overlaps, signed_area, Bounds};
use crate::hlod::flatten::mesh::NONE;
use crate::hlod::flatten::sort::unstable_sort;

/// A solid region: its outer loop's rank among the polygons, and its holes' ranks.
pub(super) struct Region {
    pub(super) outer: usize,
    pub(super) holes: Vec<usize>,
}

/// A polygon's size, whether it is an outer loop, and its box.
struct Measure {
    size: f64,
    outer: bool,
    bounds: Bounds,
}

/// The solid regions of `polygons` (module doc).
pub(super) fn solid_regions(polygons: &[Vec<[f64; 2]>]) -> Vec<Region> {
    let measures: Vec<Measure> = (polygons.iter())
        .map(|polygon| {
            let signed = signed_area(polygon);
            let outer = signed > 0.0;
            Measure {
                size: if outer { signed } else { -signed },
                outer,
                bounds: Bounds::of(polygon),
            }
        })
        .collect();
    let count = polygons.len();
    let mut order: Vec<usize> = (0..count).collect();
    unstable_sort(&mut order, |&a, &b| measures[a].size > measures[b].size);
    // Each polygon's outer loop, both by their places in `order`.
    let mut parent = vec![NONE; count];
    for p in 0..count.saturating_sub(1) {
        let loop_measure = &measures[order[p]];
        if !loop_measure.outer {
            continue;
        }
        let outer = &polygons[order[p]];
        for c in p + 1..count {
            let hole = order[c];
            if measures[hole].outer {
                continue;
            }
            let held =
                loop_measure.bounds.holds(&measures[hole].bounds) && holds(outer, &polygons[hole]);
            let overlapping =
                |r: usize| parent[r] == p && overlaps(&polygons[order[r]], &polygons[hole]);
            if held && !(p + 1..c).any(overlapping) {
                parent[c] = p;
            }
        }
    }
    let mut taken = vec![false; count];
    let mut regions = Vec::new();
    for k in 0..count {
        if taken[k] || !measures[order[k]].outer {
            continue;
        }
        let mut holes = Vec::new();
        for h in k + 1..count {
            if parent[h] == k {
                holes.push(order[h]);
                taken[h] = true;
            }
        }
        regions.push(Region {
            outer: order[k],
            holes,
        });
    }
    regions
}
