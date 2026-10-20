//! The dual, faces, components and the first patches.
use super::{Entry, Topology, INITIAL_PATCHES, MIN_PATCH_SIZE};
use rayon::prelude::*;
use std::collections::{BinaryHeap, HashMap, HashSet};
use trillion3d_math::vec3::{cross, normalized_or};
use trillion3d_math::vecn::{dot, length, sub};

/// The triangles' neighbours across shared edges: the dual graph.
pub(super) fn dual(topology: &Topology) -> Vec<Vec<usize>> {
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
pub(super) fn initial_patches(topology: &Topology, links: &[Vec<usize>]) -> Vec<Vec<usize>> {
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
