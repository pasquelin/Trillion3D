//! Metrics, islands and their orientation.
use super::expmap::expmap;
use super::{Topology, CLAMP_DISTORTION, MAX_NORMAL_DEVIATION, MERGING_THRESHOLD};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use trillion3d_math::vec3::{cross, normalized_or};
use trillion3d_math::vecn::{dot, length, sub};

/// What the merging weighs of an island candidate: its mean squared area
/// distortion and its area-weighted normal.
#[derive(Clone, Copy)]
struct Metrics {
    pub(super) distortion: f64,
    pub(super) normal: [f64; 3],
}

/// The metrics of `triangles` under their exponential map: per triangle the ratio of its larger to
/// its smaller area, surface or map, squared and weighed by area; an unreached or turned triangle
/// counts at the clamp.
fn metrics(topology: &Topology, triangles: &[usize]) -> Metrics {
    let (vertices, uv) = expmap(topology, triangles);
    let (mut sum, mut area_sum, mut normal) = (0.0f64, 0.0f64, [0.0f64; 3]);
    for &t in triangles {
        let tri = topology.triangles[t];
        let [a, b, c] = tri.map(|v| topology.points[v]);
        let n = cross(sub(b, a), sub(c, a));
        let area = length(n) * 0.5;
        for k in 0..3 {
            normal[k] += n[k] * 0.5;
        }
        area_sum += area;
        let Some([p, q, r]) = tri
            .iter()
            .map(|v| vertices.binary_search(v).ok().and_then(|at| uv[at]))
            .collect::<Option<Vec<_>>>()
            .map(|v| [v[0], v[1], v[2]])
        else {
            sum += area * CLAMP_DISTORTION * CLAMP_DISTORTION;
            continue;
        };
        let signed = 0.5 * ((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]));
        let flat = signed.abs();
        let mut distortion = (area.max(flat) / area.min(flat).max(1e-300)).min(CLAMP_DISTORTION);
        // A turned triangle is the worst there is.
        if signed < 0.0 {
            distortion = CLAMP_DISTORTION;
        }
        sum += area * distortion * distortion;
    }
    Metrics {
        distortion: if area_sum > 0.0 { sum / area_sum } else { 1.0 },
        normal: normalized_or(normal, [0.0, 0.0, 1.0]),
    }
}

/// The islands: patches merged pairwise, least normal turn plus distortion change first.
pub(super) fn islands(
    topology: &Topology,
    links: &[Vec<usize>],
    patches: Vec<Vec<usize>>,
) -> Vec<Vec<usize>> {
    let mut regions: Vec<Vec<usize>> = patches;
    let mut of = vec![0usize; topology.triangles.len()];
    for (rank, region) in regions.iter().enumerate() {
        for &t in region {
            of[t] = rank;
        }
    }
    let mut measured: Vec<Metrics> = regions.par_iter().map(|r| metrics(topology, r)).collect();
    let invalid = 4.0 * MERGING_THRESHOLD;
    let steps = [8.0, 4.0, 2.0, 1.0].map(|d| MAX_NORMAL_DEVIATION / d);
    let angle = |a: [f64; 3], b: [f64; 3]| dot(a, b).clamp(-1.0, 1.0).acos();
    let mut failed: HashSet<(usize, usize)> = HashSet::new();
    // Each pair's joined metrics, kept while neither region has changed since.
    let mut versions = vec![0u32; regions.len()];
    let mut cache: HashMap<(usize, usize), (u32, u32, Metrics)> = HashMap::new();
    let mut step = 0;
    loop {
        let threshold = steps[step];
        // Every neighbouring pair not failed yet.
        let mut pairs: Vec<(usize, usize)> = Vec::new();
        for (rank, region) in regions.iter().enumerate() {
            for &t in region {
                for &m in &links[t] {
                    let other = of[m];
                    if other != rank {
                        let pair = (rank.min(other), rank.max(other));
                        if !failed.contains(&pair) {
                            pairs.push(pair);
                        }
                    }
                }
            }
        }
        pairs.sort_unstable();
        pairs.dedup();
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
                let mut both = regions[a].clone();
                both.extend_from_slice(&regions[b]);
                metrics(topology, &both)
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
            turn + da.max(db)
        };
        let mut order: Vec<usize> = (0..pairs.len()).collect();
        order.sort_by(|&x, &y| score(x).total_cmp(&score(y)).then(x.cmp(&y)));
        let mut touched = vec![false; regions.len()];
        let mut merged = false;
        for k in order {
            let (a, b) = pairs[k];
            if touched[a] || touched[b] {
                continue;
            }
            let normals_ok = angle(measured[a].normal, measured[b].normal).to_degrees() < threshold;
            let distortion = joined[k].distortion;
            if !normals_ok || distortion > invalid {
                failed.insert((a, b));
            } else if distortion < MERGING_THRESHOLD {
                let moved = std::mem::take(&mut regions[b]);
                for &t in &moved {
                    of[t] = a;
                }
                regions[a].extend(moved);
                measured[a] = joined[k];
                versions[a] += 1;
                versions[b] += 1;
                touched[a] = true;
                touched[b] = true;
                merged = true;
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
    regions.retain(|r| !r.is_empty());
    for region in &mut regions {
        region.sort_unstable();
    }
    regions
}

/// The rotation turning `points` to their least-area bounding box (rotating calipers): the
/// convex hull's edge directions tried in turn; `None` when the axis-aligned box is least.
pub(super) fn orientation(points: &[[f64; 2]]) -> Option<f64> {
    let mut sorted: Vec<[f64; 2]> = points.to_vec();
    sorted.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    sorted.dedup();
    if sorted.len() < 3 {
        return None;
    }
    let turn = |o: [f64; 2], a: [f64; 2], b: [f64; 2]| {
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    };
    let mut hull: Vec<[f64; 2]> = Vec::new();
    for pass in 0..2 {
        let start = hull.len();
        let iter: Box<dyn Iterator<Item = &[f64; 2]>> = if pass == 0 {
            Box::new(sorted.iter())
        } else {
            Box::new(sorted.iter().rev())
        };
        for &p in iter {
            while hull.len() >= start + 2
                && turn(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0
            {
                hull.pop();
            }
            hull.push(p);
        }
        hull.pop();
    }
    let area = |axis: [f64; 2]| {
        let across = [axis[1], -axis[0]];
        let (mut a0, mut a1, mut b0, mut b1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for p in &hull {
            let (s, t) = (
                p[0] * axis[0] + p[1] * axis[1],
                p[0] * across[0] + p[1] * across[1],
            );
            a0 = a0.min(s);
            a1 = a1.max(s);
            b0 = b0.min(t);
            b1 = b1.max(t);
        }
        (a1 - a0) * (b1 - b0)
    };
    let mut best = area([1.0, 0.0]);
    let mut chosen = None;
    for k in 0..hull.len() {
        let (a, b) = (hull[k], hull[(k + 1) % hull.len()]);
        let d = [b[0] - a[0], b[1] - a[1]];
        let l = d[0].hypot(d[1]);
        if l <= 0.0 {
            continue;
        }
        let axis = [d[0] / l, d[1] / l];
        let here = area(axis);
        if here < best {
            best = here;
            chosen = Some(axis[1].atan2(axis[0]));
        }
    }
    chosen
}
