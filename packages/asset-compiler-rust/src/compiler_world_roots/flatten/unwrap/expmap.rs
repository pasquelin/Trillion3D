//! The frame, the propagation and the exponential map.
use super::{Entry, Topology};
use std::collections::{BinaryHeap, HashMap};
use trillion3d_math::vec3::{cross, normalized_or};
use trillion3d_math::vecn::{dot, length, sub};

/// A frame on the surface: its origin and three unit axes, `z` its normal.
#[derive(Clone, Copy)]
struct Frame {
    pub(super) origin: [f64; 3],
    pub(super) x: [f64; 3],
    pub(super) y: [f64; 3],
    pub(super) z: [f64; 3],
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
    pub(super) fn new(origin: [f64; 3], normal: [f64; 3]) -> Self {
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
pub(super) fn expmap(
    topology: &Topology,
    triangles: &[usize],
) -> (Vec<usize>, Vec<Option<[f64; 2]>>) {
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
