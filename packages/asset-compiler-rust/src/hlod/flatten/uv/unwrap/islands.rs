//! The islands, patches merged pairwise (`islands`), and their orientation (`orient`).
use super::base::Base;
use super::measure::{metrics, Metrics};
use super::regions::Regions;
use crate::hlod::flatten::planar::hull::convex_hull_single;
use crate::hlod::flatten::sort::unstable_sort;
use crate::hlod::options::HlodPatches;
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use trillion3d_math::vector::vecn::dot;

/// The compactness past which no two patches merge: never, in effect.
const COMPACTNESS_THRESHOLD: f64 = 9_999_999.0;

/// The angle between unit `a` and unit `b`, radians.
fn angle(a: [f64; 3], b: [f64; 3]) -> f64 {
    dot(a, b).clamp(-1.0, 1.0).acos()
}

/// The islands: `patches` of `base`, their triangles `across` one another's sides, merged pair by
/// pair. Each pass lists every standing patch's neighbours of a higher rank in order
/// (`Regions`), the pairs not failed since the normal deviation last grew, measured joined
/// (`metrics`) and sorted (`unstable_sort`) by ten times their normals' angle plus the larger
/// change of distortion; then each pair, neither of it merged this pass, fails when its normals
/// part by the deviation of the pass or more, when it is not compact enough or when it distorts past four
/// times the merging threshold, and merges — the higher-ranked patch's triangles appended to the
/// other's — when it distorts under the threshold. The deviation allowed grows in four steps to
/// `settings`' own whenever a pass merges nothing.
pub(super) fn islands(
    base: &Base,
    across: &[[usize; 3]],
    patches: Vec<Vec<usize>>,
    settings: &HlodPatches,
) -> Vec<Vec<usize>> {
    let (merging_threshold, max_normal_deviation) =
        (settings.merging_threshold, settings.max_angle_deviation);
    let mut graph = Regions::of(across, patches);
    let count = graph.count();
    let mut measured: Vec<Metrics> = (0..count)
        .into_par_iter()
        .map(|k| metrics(base, graph.triangles(k)))
        .collect();
    let invalid = 4.0 * merging_threshold;
    let steps = [8.0, 4.0, 2.0, 1.0].map(|d| max_normal_deviation / d);
    let mut failed: HashSet<(usize, usize)> = HashSet::new();
    // Each pair's joined metrics, kept while neither patch has changed since.
    let mut versions = vec![0u32; count];
    let mut cache: HashMap<(usize, usize), (u32, u32, Metrics)> = HashMap::new();
    let mut step = 0;
    loop {
        let threshold = steps[step];
        let pairs: Vec<(usize, usize)> = (0..count)
            .filter(|&k| graph.is_region(k))
            .flat_map(|a| graph.neighbours(a).iter().map(move |&b| (a, b)))
            .filter(|&(a, b)| a < b && !failed.contains(&(a, b)))
            .collect();
        let stale: Vec<(usize, usize)> = (pairs.iter().copied())
            .filter(|&(a, b)| {
                cache
                    .get(&(a, b))
                    .is_none_or(|&(va, vb, _)| va != versions[a] || vb != versions[b])
            })
            .collect();
        let fresh: Vec<Metrics> = stale
            .par_iter()
            .map(|&(a, b)| {
                let both = [graph.triangles(a), graph.triangles(b)].concat();
                metrics(base, &both)
            })
            .collect();
        for (&(a, b), m) in stale.iter().zip(fresh) {
            cache.insert((a, b), (versions[a], versions[b], m));
        }
        let joined: Vec<Metrics> = pairs.iter().map(|pair| cache[pair].2).collect();
        let score = |k: usize| {
            let (a, b) = pairs[k];
            let turn = angle(measured[a].normal, measured[b].normal) * 10.0;
            let da = (joined[k].distortion - measured[a].distortion).abs();
            let db = (joined[k].distortion - measured[b].distortion).abs();
            turn + if db < da { da } else { db }
        };
        let mut order: Vec<usize> = (0..pairs.len()).collect();
        unstable_sort(&mut order, |&x, &y| score(x) < score(y));
        let mut touched = vec![false; count];
        let mut merged = false;
        for k in order {
            let (a, b) = pairs[k];
            if touched[a] || touched[b] {
                continue;
            }
            let normals_ok = angle(measured[a].normal, measured[b].normal).to_degrees() < threshold;
            let compact = joined[k].compactness < COMPACTNESS_THRESHOLD;
            let distortion = joined[k].distortion;
            if !normals_ok || !compact || distortion > invalid {
                failed.insert((a, b));
            } else if distortion < merging_threshold {
                if graph.merge(b, a) {
                    measured[a] = joined[k];
                    versions[a] += 1;
                    versions[b] += 1;
                    touched[a] = true;
                    touched[b] = true;
                    merged = true;
                } else {
                    failed.insert((a, b));
                }
            }
        }
        if !merged {
            if step + 1 == steps.len() {
                break;
            }
            step += 1;
            failed.clear();
        }
    }
    // Each island's triangles in the order its merges appended them: the order its map is drawn
    // in (`submesh.rs`).
    (graph.into_sets().into_iter())
        .filter(|island| !island.is_empty())
        .collect()
}

/// The greater of `a` and `b` in single precision: `a` when `a >= b`, `b` otherwise, so a number
/// that is not one never wins against a comparison it fails.
fn larger(a: f32, b: f32) -> f32 {
    if a >= b {
        a
    } else {
        b
    }
}

/// `span` — a least and a greatest value, `[f32::MAX, -f32::MAX]` while it holds none — grown to
/// hold `value`.
fn grow(span: &mut [f32; 2], value: f32) {
    if value < span[0] {
        span[0] = value;
    }
    if value > span[1] {
        span[1] = value;
    }
}

/// Turns `points` — an island's map, one entry per vertex, in the order its triangles first name
/// them — to the rotation at which their bounding box is least (rotating calipers), every value
/// and every operation in single precision, in this order:
///
/// 1. the axis-aligned box of the points, its centre and its area (each side at least zero), and
///    every point taken to that centre;
/// 2. the convex hull of the points so shifted (`convex_hull_single`), its corners in the order the
///    hull leaves them; nothing turns when the points have no hull, fewer than three distinct
///    ones or all of them on one line;
/// 3. each hull edge in turn, as the axis of a box over all the corners: its length and its unit
///    direction (zero for an edge of no length), the perpendicular a quarter turn clockwise, then
///    the two extents, along the direction and across it. The extent along starts at the edge's
///    length, the one across at the offset, across the perpendicular, of the corner half a hull
///    on from the edge's start; each then takes the span of the corners' projections so far when
///    that is greater, one corner after another. The extents only grow, so an edge whose box
///    area passes the least area so far is given up as soon as it does, whatever order the
///    corners are taken in. The least area starts as the axis-aligned box's, its direction as the
///    x axis; an edge whose box area is strictly less becomes the least, its direction the one
///    kept;
/// 4. when an edge beat the axis-aligned box, every point turned about the centre, by the angle
///    that brings the kept direction onto the x axis.
pub(super) fn orient(points: &mut [[f32; 2]]) {
    if points.is_empty() {
        return;
    }
    let mut sides = [[f32::MAX, -f32::MAX]; 2];
    for p in points.iter() {
        grow(&mut sides[0], p[0]);
        grow(&mut sides[1], p[1]);
    }
    let centre = [
        (sides[0][0] + sides[0][1]) * 0.5,
        (sides[1][0] + sides[1][1]) * 0.5,
    ];
    let shifted: Vec<[f32; 2]> = (points.iter())
        .map(|p| [p[0] - centre[0], p[1] - centre[1]])
        .collect();
    let Some(ranks) = convex_hull_single(&shifted) else {
        return;
    };
    let corners: Vec<[f32; 2]> = ranks.iter().map(|&r| shifted[r]).collect();
    let count = corners.len();
    let mut least = larger(sides[0][1] - sides[0][0], 0.0) * larger(sides[1][1] - sides[1][0], 0.0);
    let mut kept = [1.0f32, 0.0];
    let mut smaller = false;
    for k in 0..count {
        let (a, b, c) = (
            corners[k],
            corners[(k + 1) % count],
            corners[(k + count / 2) % count],
        );
        let edge = [b[0] - a[0], b[1] - a[1]];
        let length = (edge[0] * edge[0] + edge[1] * edge[1]).sqrt();
        let (axis, mut along) = if length > 0.0 {
            let inverse = 1.0 / length;
            ([edge[0] * inverse, edge[1] * inverse], length)
        } else {
            ([0.0; 2], 0.0)
        };
        let side = [axis[1], -axis[0]];
        let mut across = (c[0] - a[0]) * side[0] + (c[1] - a[1]) * side[1];
        let (mut span_along, mut span_across) = ([f32::MAX, -f32::MAX], [f32::MAX, -f32::MAX]);
        let mut given_up = false;
        for p in &corners {
            grow(&mut span_along, axis[0] * p[0] + axis[1] * p[1]);
            along = larger(along, span_along[1] - span_along[0]);
            grow(&mut span_across, side[0] * p[0] + side[1] * p[1]);
            across = larger(across, span_across[1] - span_across[0]);
            if along * across > least {
                given_up = true;
                break;
            }
        }
        if !given_up && along * across < least {
            least = along * across;
            kept = axis;
            smaller = true;
        }
    }
    if !smaller {
        return;
    }
    let angle = kept[1].atan2(kept[0]);
    let (sin, cos) = (-angle).sin_cos();
    let rows = [[cos, -sin], [sin, cos]];
    for p in points.iter_mut() {
        let v = [p[0] - centre[0], p[1] - centre[1]];
        *p = [
            rows[0][0] * v[0] + rows[0][1] * v[1] + centre[0],
            rows[1][0] * v[0] + rows[1][1] * v[1] + centre[1],
        ];
    }
}
