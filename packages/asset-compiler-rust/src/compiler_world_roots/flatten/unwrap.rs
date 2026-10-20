//! Unique texture coordinates for a mesh whose material is baked, by growing patches into
//! islands that each flatten with little stretch:
//!
//! 1. small patches (`initial_patches`): seeds spread by area, each component's furthest point
//!    from the seeds so far added in turn (farthest-point sampling), then every triangle given to
//!    the seed nearest by a distance weighed by the turn of its normal from the seed's, so patches
//!    follow the surface's creases;
//! 2. islands (`islands`): neighbouring patches merged while the exponential map of the pair keeps
//!    its mean squared area distortion under the threshold, the normal deviation allowed growing in
//!    four steps so flat regions join first;
//! 3. each island's discrete exponential map (Schmidt et al. 2006, `expmap`: upwind average from
//!    the vertex furthest from its boundary), turned to its least bounding box (`orientation`),
//!    then packed (`pack.rs`).
use rayon::prelude::*;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};
use trillion3d_math::vec3::{cross, normalized_or};
use trillion3d_math::vecn::{dot, length, sub};

/// The unwrap's settings: initial patch count, merging threshold (mean squared area distortion an
/// island may reach), normal deviation (degrees two merged patches may differ by), least patch
/// size in triangles.
const INITIAL_PATCHES: usize = 250;
const MERGING_THRESHOLD: f64 = 1.5;
const MAX_NORMAL_DEVIATION: f64 = 45.0;
const MIN_PATCH_SIZE: usize = 2;
/// The clamp of a triangle's area distortion, so one degenerate triangle cannot swamp the mean.
const CLAMP_DISTORTION: f64 = 100.0;

/// A mesh's topology for the unwrap: welded positions and triangles.
pub(super) struct Topology<'a> {
    pub points: &'a [[f64; 3]],
    pub triangles: &'a [[usize; 3]],
}

/// A min-heap entry of a Dijkstra: distance, node.
#[derive(PartialEq)]
struct Entry(f64, usize);
impl Eq for Entry {}
impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        other.0.total_cmp(&self.0).then(other.1.cmp(&self.1))
    }
}

/// The triangles' neighbours across shared edges: the dual graph.
fn dual(topology: &Topology) -> Vec<Vec<usize>> {
    let mut by_edge: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for (t, tri) in topology.triangles.iter().enumerate() {
        for k in 0..3 {
            let (a, b) = (tri[k], tri[(k + 1) % 3]);
            by_edge.entry((a.min(b), a.max(b))).or_default().push(t);
        }
    }
    let mut out = vec![Vec::new(); topology.triangles.len()];
    for tris in by_edge.values() {
        for &a in tris {
            for &b in tris {
                if a != b {
                    out[a].push(b);
                }
            }
        }
    }
    // Each once, in triangle order, whatever order the edges were hashed in: the pairs, their ties
    // and the charts follow it.
    for neighbours in &mut out {
        neighbours.sort_unstable();
        neighbours.dedup();
    }
    out
}

/// The triangles' centroids, unit normals and areas.
fn faces(topology: &Topology) -> (Vec<[f64; 3]>, Vec<[f64; 3]>, Vec<f64>) {
    let mut centroids = Vec::new();
    let mut normals = Vec::new();
    let mut areas = Vec::new();
    for tri in topology.triangles {
        let [a, b, c] = tri.map(|v| topology.points[v]);
        centroids.push(trillion3d_math::triangle::centroid([a, b, c]));
        let n = cross(sub(b, a), sub(c, a));
        areas.push(length(n) * 0.5);
        normals.push(normalized_or(n, [0.0, 0.0, 1.0]));
    }
    (centroids, normals, areas)
}

/// The connected components of `nodes` over `links`, each as its nodes in increasing order.
fn components(
    nodes: &[usize],
    links: &[Vec<usize>],
    member: &dyn Fn(usize) -> bool,
) -> Vec<Vec<usize>> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for &start in nodes {
        if !seen.insert(start) {
            continue;
        }
        let mut stack = vec![start];
        let mut component = Vec::new();
        while let Some(n) = stack.pop() {
            component.push(n);
            for &m in &links[n] {
                if member(m) && seen.insert(m) {
                    stack.push(m);
                }
            }
        }
        component.sort_unstable();
        out.push(component);
    }
    out
}

/// The initial patches: seeds spread by area, grown by normal-weighed distance.
fn initial_patches(topology: &Topology, links: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let (centroids, normals, areas) = faces(topology);
    let count = topology.triangles.len();
    let all: Vec<usize> = (0..count).collect();
    let parts = components(&all, links, &|_| true);
    let total: f64 = areas.iter().sum();
    let per_seed = total / INITIAL_PATCHES.min(count).max(1) as f64;
    let step = |a: usize, b: usize| length(sub(centroids[a], centroids[b]));
    // Furthest points per component, by an incremental Dijkstra from the seeds so far.
    let seeds: Vec<usize> = parts
        .par_iter()
        .flat_map_iter(|part| {
            let area: f64 = part.iter().map(|&t| areas[t]).sum();
            let wanted = ((area / per_seed).ceil() as usize).max(1);
            let mut seeds = vec![part[0]];
            if wanted == 1 {
                return seeds;
            }
            let mut distance: HashMap<usize, f64> = HashMap::new();
            let grow = |seed: usize, distance: &mut HashMap<usize, f64>| {
                let mut heap = BinaryHeap::new();
                distance.insert(seed, 0.0);
                heap.push(Entry(0.0, seed));
                while let Some(Entry(d, n)) = heap.pop() {
                    if d > distance[&n] {
                        continue;
                    }
                    for &m in &links[n] {
                        let next = d + step(n, m);
                        if distance.get(&m).is_none_or(|&old| next < old) {
                            distance.insert(m, next);
                            heap.push(Entry(next, m));
                        }
                    }
                }
            };
            grow(part[0], &mut distance);
            while seeds.len() < wanted {
                let furthest = part
                    .iter()
                    .copied()
                    .max_by(|a, b| distance[a].total_cmp(&distance[b]).then(b.cmp(a)));
                match furthest {
                    Some(t) if distance[&t] > 0.0 => {
                        seeds.push(t);
                        grow(t, &mut distance);
                    }
                    _ => break,
                }
            }
            seeds
        })
        .collect();
    // Superpixels: each triangle to the seed nearest by the weighed distance.
    let mut owner = vec![usize::MAX; count];
    let mut distance = vec![f64::INFINITY; count];
    let mut heap = BinaryHeap::new();
    for (rank, &seed) in seeds.iter().enumerate() {
        owner[seed] = rank;
        distance[seed] = 0.0;
        heap.push(Entry(0.0, seed));
    }
    while let Some(Entry(d, n)) = heap.pop() {
        if d > distance[n] {
            continue;
        }
        let seed = seeds[owner[n]];
        for &m in &links[n] {
            let cosine = dot(normals[m], normals[seed]);
            let w = (1.0 - cosine * cosine)
                .clamp(0.0, 1.0)
                .powi(3)
                .clamp(0.001, 1.0);
            let next = d + w * step(n, m);
            if next < distance[m] {
                distance[m] = next;
                owner[m] = owner[n];
                heap.push(Entry(next, m));
            }
        }
    }
    let mut groups: Vec<Vec<usize>> = vec![Vec::new(); seeds.len()];
    for t in 0..count {
        groups[owner[t]].push(t);
    }
    // Each group's connected parts.
    let mut patches = Vec::new();
    for (rank, group) in groups
        .into_iter()
        .enumerate()
        .filter(|(_, g)| !g.is_empty())
    {
        patches.extend(components(&group, links, &|t| owner[t] == rank));
    }
    // A patch under the least size joins its most bordering neighbour.
    let mut of = vec![0usize; count];
    for (rank, patch) in patches.iter().enumerate() {
        for &t in patch {
            of[t] = rank;
        }
    }
    for rank in 0..patches.len() {
        if patches[rank].is_empty() || patches[rank].len() >= MIN_PATCH_SIZE {
            continue;
        }
        let mut borders: HashMap<usize, usize> = HashMap::new();
        for &t in &patches[rank] {
            for &m in &links[t] {
                if of[m] != rank {
                    *borders.entry(of[m]).or_default() += 1;
                }
            }
        }
        if let Some((&into, _)) = borders
            .iter()
            .max_by_key(|(&r, &n)| (n, std::cmp::Reverse(r)))
        {
            let moved = std::mem::take(&mut patches[rank]);
            for &t in &moved {
                of[t] = into;
            }
            patches[into].extend(moved);
        }
    }
    patches.retain(|p| !p.is_empty());
    patches
}

/// A frame on the surface: its origin and three unit axes, `z` its normal.
#[derive(Clone, Copy)]
struct Frame {
    origin: [f64; 3],
    x: [f64; 3],
    y: [f64; 3],
    z: [f64; 3],
}

/// The least rotation taking unit `from` to unit `to`, applied to `v` (Rodrigues).
fn rotate_onto(from: [f64; 3], to: [f64; 3], v: [f64; 3]) -> [f64; 3] {
    let c = dot(from, to);
    if c < -1.0 + 1e-12 {
        // Half a turn about any axis across `from`.
        let axis = normalized_or(
            cross(
                from,
                if from[0].abs() < 0.9 {
                    [1.0, 0.0, 0.0]
                } else {
                    [0.0, 1.0, 0.0]
                },
            ),
            [0.0, 0.0, 1.0],
        );
        let along = dot(axis, v);
        return std::array::from_fn(|k| 2.0 * along * axis[k] - v[k]);
    }
    let axis = cross(from, to);
    let across = cross(axis, v);
    let along = dot(axis, v) / (1.0 + c);
    std::array::from_fn(|k| v[k] * c + across[k] + axis[k] * along)
}

impl Frame {
    /// The frame at `origin` with normal `normal`: the unit axes turned by the least rotation of
    /// `+Z` onto `normal`.
    fn new(origin: [f64; 3], normal: [f64; 3]) -> Self {
        let z = [0.0, 0.0, 1.0];
        Self {
            origin,
            x: rotate_onto(z, normal, [1.0, 0.0, 0.0]),
            y: rotate_onto(z, normal, [0.0, 1.0, 0.0]),
            z: normal,
        }
    }
    fn local(&self, p: [f64; 3]) -> [f64; 2] {
        let d = sub(p, self.origin);
        [dot(d, self.x), dot(d, self.y)]
    }
}

/// `position` in the frame of a neighbour whose coordinates are `nbr_uv`, turned into the seed
/// frame's orientation aligned with the neighbour's normal.
fn propagate(position: [f64; 3], nbr_uv: [f64; 2], nbr: &Frame, seed: &Frame) -> [f64; 2] {
    let local = nbr.local(position);
    let aligned_x = rotate_onto(seed.z, nbr.z, seed.x);
    let cos = dot(nbr.x, aligned_x);
    let mut sin = (1.0 - cos * cos).max(0.0).sqrt();
    if dot(cross(nbr.x, aligned_x), nbr.z) < 0.0 {
        sin = -sin;
    }
    [
        nbr_uv[0] + cos * local[0] + sin * local[1],
        nbr_uv[1] - sin * local[0] + cos * local[1],
    ]
}

/// The exponential map of `triangles` by upwind averaging from the vertex furthest from their
/// boundary — their geodesic centre, so distortion spreads evenly — or their first vertex when
/// closed: their vertices, ascending, and per vertex its coordinates, metres, `None` where the
/// map does not reach.
fn expmap(topology: &Topology, triangles: &[usize]) -> (Vec<usize>, Vec<Option<[f64; 2]>>) {
    let mut vertices: Vec<usize> = triangles
        .iter()
        .flat_map(|&t| topology.triangles[t])
        .collect();
    vertices.sort_unstable();
    vertices.dedup();
    let local = |v: usize| vertices.binary_search(&v).unwrap_or(0);
    let count = vertices.len();
    let mut neighbours: Vec<Vec<usize>> = vec![Vec::new(); count];
    let mut normals = vec![[0.0f64; 3]; count];
    let mut edges: HashMap<(usize, usize), u32> = HashMap::new();
    for &t in triangles {
        let tri = topology.triangles[t].map(local);
        let [a, b, c] = tri.map(|v| topology.points[vertices[v]]);
        let n = cross(sub(b, a), sub(c, a));
        for k in 0..3 {
            let (v, w) = (tri[k], tri[(k + 1) % 3]);
            if !neighbours[v].contains(&w) {
                neighbours[v].push(w);
            }
            if !neighbours[w].contains(&v) {
                neighbours[w].push(v);
            }
            *edges.entry((v.min(w), v.max(w))).or_default() += 1;
            for a in 0..3 {
                normals[v][a] += n[a];
            }
        }
    }
    let normal = |v: usize| normalized_or(normals[v], [0.0, 0.0, 1.0]);
    let point = |v: usize| topology.points[vertices[v]];
    // The boundary's vertices seed a Dijkstra; its furthest vertex is the seed.
    let mut boundary: Vec<usize> = (edges.iter())
        .filter(|(_, &n)| n == 1)
        .flat_map(|(&(a, b), _)| [a, b])
        .collect();
    // In vertex order, whatever order the edges were hashed in.
    boundary.sort_unstable();
    boundary.dedup();
    let mut seed = 0;
    if !boundary.is_empty() {
        let mut distance = vec![f64::INFINITY; count];
        let mut heap = BinaryHeap::new();
        for &v in &boundary {
            distance[v] = 0.0;
            heap.push(Entry(0.0, v));
        }
        while let Some(Entry(d, n)) = heap.pop() {
            if d > distance[n] {
                continue;
            }
            for &m in &neighbours[n] {
                let next = d + length(sub(point(n), point(m)));
                if next < distance[m] {
                    distance[m] = next;
                    heap.push(Entry(next, m));
                }
            }
        }
        // A vertex no boundary reaches counts as at the boundary.
        let reached = |v: usize| {
            if distance[v].is_finite() {
                distance[v]
            } else {
                0.0
            }
        };
        seed = (0..count)
            .max_by(|&a, &b| reached(a).total_cmp(&reached(b)).then(b.cmp(&a)))
            .unwrap_or(0);
    }
    let seed_frame = Frame::new(point(seed), normal(seed));
    let frame = |v: usize| Frame::new(point(v), normal(v));
    let mut uv: Vec<Option<[f64; 2]>> = vec![None; count];
    let mut graph = vec![f64::INFINITY; count];
    let mut heap = BinaryHeap::new();
    graph[seed] = 0.0;
    heap.push(Entry(0.0, seed));
    while let Some(Entry(d, n)) = heap.pop() {
        if uv[n].is_some() || d > graph[n] {
            continue;
        }
        let here = if n == seed {
            [0.0, 0.0]
        } else {
            // Upwind average over the frozen neighbours, weighed by inverse squared distance.
            let (mut sum, mut weight) = ([0.0f64; 2], 0.0f64);
            for &m in &neighbours[n] {
                if let Some(muv) = uv[m] {
                    let f = frame(m);
                    let p = propagate(point(n), muv, &f, &seed_frame);
                    let w = 1.0 / (length(sub(point(n), f.origin)).powi(2) + 1e-8);
                    sum = [sum[0] + w * p[0], sum[1] + w * p[1]];
                    weight += w;
                }
            }
            [sum[0] / weight, sum[1] / weight]
        };
        uv[n] = Some(here);
        for &m in &neighbours[n] {
            if uv[m].is_some() {
                continue;
            }
            let next = d + length(sub(point(n), point(m)));
            if next < graph[m] {
                graph[m] = next;
                heap.push(Entry(next, m));
            }
        }
    }
    (vertices, uv)
}

/// What the merging weighs of an island candidate: its mean squared area
/// distortion and its area-weighted normal.
#[derive(Clone, Copy)]
struct Metrics {
    distortion: f64,
    normal: [f64; 3],
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
fn islands(topology: &Topology, links: &[Vec<usize>], patches: Vec<Vec<usize>>) -> Vec<Vec<usize>> {
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
fn orientation(points: &[[f64; 2]]) -> Option<f64> {
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

/// Per corner of `topology`'s triangles, its island's coordinates in metres, turned to its least
/// box, and the islands as triangle lists.
pub(super) fn unwrap(topology: &Topology) -> (Vec<[f64; 2]>, Vec<Vec<usize>>) {
    let links = dual(topology);
    let patches = initial_patches(topology, &links);
    let islands = islands(topology, &links, patches);
    let mut corners = vec![[0.0f64; 2]; topology.triangles.len() * 3];
    let mapped: Vec<(Vec<usize>, Vec<[f64; 2]>)> = islands
        .par_iter()
        .map(|island| {
            let (vertices, uv) = expmap(topology, island);
            let reached: Vec<[f64; 2]> = uv.iter().flatten().copied().collect();
            let mut uv: Vec<[f64; 2]> = uv.into_iter().map(|p| p.unwrap_or([0.0; 2])).collect();
            if let Some(angle) = orientation(&reached) {
                let (sin, cos) = (-angle).sin_cos();
                for p in uv.iter_mut() {
                    *p = [cos * p[0] - sin * p[1], sin * p[0] + cos * p[1]];
                }
            }
            (vertices, uv)
        })
        .collect();
    for (island, (vertices, uv)) in islands.iter().zip(&mapped) {
        for &t in island {
            for k in 0..3 {
                let v = topology.triangles[t][k];
                corners[t * 3 + k] = vertices.binary_search(&v).map_or([0.0; 2], |at| uv[at]);
            }
        }
    }
    (corners, islands)
}
