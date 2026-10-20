//! THE TRIANGLE CLUSTERER, one for the compiler's DAG levels and for the cuts the world makes at
//! run time (`wasm_clusters.rs`, in the page worker): indexed triangles in, clusters out.
//!
//! Free to reorder (an opaque cut, a cooked mesh), the clusters are the parts of the triangles'
//! graph (`partition_triangles`, by `partition.rs`): two triangles that run one edge between the
//! same two positions in opposite directions share it, at a heavy cost, and a triangle of a small
//! island also links its nearest triangles of other islands, at a cost of one, so the parts stay
//! compact across the gaps of a mesh in pieces. Parts of `max - 4` to `max` triangles, each a
//! patch of the surface whatever the index order. The vertex cap is no part of that cut: at
//! encode, a cluster over it is halved in its own triangle order (`wide_half`).
//!
//! Held to the source order (`keep_order`: the paint order of a blended surface, the coplanar
//! layer of lines and sprites), the cut is the rank of least cost along that order among those
//! that leave each side whole clusters: every cluster is a run of consecutive triangles, as few as
//! the caps allow, and a run that would reach across the mesh is cut where it jumps.
//! A cluster lists its triangles in their source order; the result is the same on every build.
mod cut;

use crate::edges::{position_key, weld_by, DirectedEdges};
use crate::encode::vertices::first_use;
use crate::partition::{Fork, Islands, Partitioner, Serial};
use crate::split::centres_and_boxes;
use cut::cut_in_order;
use trillion3d_math::aabb::aabb_of_f32;
use trillion3d_math::vec3::point_checked;

/// The cost of an edge two triangles share, and of a locality link.
const SHARED_EDGE_COST: i32 = 4 * 65;
const LOCALITY_COST: i32 = 1;
/// How far under `max` triangles a part may fall.
const PART_SLACK: usize = 4;

/// Vertex `v` of a stream of three `f32` a vertex, as `f64`; NaN past the end, which no box keeps
/// and no area or length survives.
fn point(positions: &[f32], v: u32) -> [f64; 3] {
    point_checked(positions, v).unwrap_or([f64::NAN; 3])
}

/// The most triangles and distinct vertices one cluster holds: the compiler's
/// `DAG_CLUSTER_TRIANGLES` and `DAG_CLUSTER_VERTICES`, which the run-time cut reads too.
#[derive(Clone, Copy, Debug)]
pub struct Caps {
    pub triangles: usize,
    pub vertices: usize,
}

/// The clusters of a triangle list: its triangles in cluster order, and where each cluster ends,
/// in indices.
pub struct Clustered {
    pub indices: Vec<u32>,
    pub ends: Vec<usize>,
}

/// The clusters of `indices` over `positions` (three `f32` a vertex), each within `caps`, its
/// triangles in their source order; with `keep_order`, every cluster a run of the source order and
/// the clusters in that order. Free, the parts of the triangles' graph (`partition_triangles`),
/// each over the vertex cap then halved (`wide_half`), the second half after every cluster.
pub fn cluster(positions: &[f32], indices: &[u32], caps: Caps, keep_order: bool) -> Clustered {
    if keep_order {
        return cluster_in_order(positions, indices, caps);
    }
    let parts = partition_triangles(positions, indices, caps.triangles, &Serial);
    let (mut out, mut ends) = (Vec::with_capacity(indices.len()), Vec::new());
    let mut seconds = Vec::new();
    let mut start = 0;
    for &end in &parts.ends {
        let part = &parts.indices[start..end];
        let cut = wide_half(part, caps.vertices).unwrap_or(part.len());
        out.extend_from_slice(&part[..cut]);
        ends.push(out.len());
        if cut < part.len() {
            seconds.push(&part[cut..]);
        }
        start = end;
    }
    for second in seconds {
        out.extend_from_slice(second);
        ends.push(out.len());
    }
    Clustered { indices: out, ends }
}

/// Where a cluster over `cap` distinct vertices is cut in two at encode: after the first half of
/// its triangles, in its own order; `None` for a cluster within the cap.
pub fn wide_half(cluster: &[u32], cap: usize) -> Option<usize> {
    let mut vertices = cluster.to_vec();
    vertices.sort_unstable();
    vertices.dedup();
    (vertices.len() > cap && cluster.len() >= 6).then(|| cluster.len() / 3 / 2 * 3)
}

/// The parts of the graph of the triangles of `indices`, of `max - 4` to `max` triangles
/// (`Partitioner`), each part's triangles in their source order, the parts in partition order.
/// Two triangles are joined, at `SHARED_EDGE_COST`, for each of their edges that runs between the
/// same two positions in opposite directions — an edge whose two ends lie on one position is no
/// edge —; a triangle of a small island links its nearest triangles of other islands at
/// `LOCALITY_COST` (`Partitioner::locality_links`, by the centres of the triangles within the box
/// of every position). The halves of a large cut run on `fork`. A list of at most `max`
/// triangles is one part.
pub fn partition_triangles(
    positions: &[f32],
    indices: &[u32],
    max: usize,
    fork: &dyn Fork,
) -> Clustered {
    let count = indices.len() / 3;
    if count <= max {
        let ends = if count == 0 { vec![] } else { vec![count * 3] };
        return Clustered {
            indices: indices[..count * 3].to_vec(),
            ends,
        };
    }
    // Each corner's vertex welded by position; a vertex past the positions is its own.
    let vertices = (positions.len() / 3).max(indices.iter().max().map_or(0, |&v| v as usize + 1));
    let weld = weld_by(vertices, indices, |v| {
        let i = v as usize * 3;
        match positions.get(i..i + 3) {
            Some(_) => (false, position_key(positions, v), 0),
            None => (true, [0; 3], v),
        }
    });
    let next = |e: usize| e / 3 * 3 + (e % 3 + 1) % 3;
    let ends = |e: usize| (weld[indices[e] as usize], weld[indices[next(e)] as usize]);
    let corners = count * 3;
    let edges = DirectedEdges::of(
        (0..corners)
            .map(|e| (ends(e), e as u32))
            .filter(|&((a, b), _)| a != b)
            .map(|((a, b), e)| (a, b, e))
            .collect(),
        |edges| edges.sort_unstable(),
    );
    // Each edge's run, then the edges running it back, in edge order.
    let mut run_of = vec![u32::MAX; corners];
    for run in 0..edges.runs() {
        edges
            .run(run)
            .iter()
            .for_each(|&(_, _, e)| run_of[e as usize] = run as u32);
    }
    let opposite = |e: usize| opposite(&edges, &run_of, e);
    let mut islands = Islands::new(count);
    for e in 0..corners {
        for &(_, _, o) in opposite(e) {
            islands.union((e / 3) as u32, o / 3);
        }
    }
    let at = |v: u32| -> [f32; 3] {
        let i = v as usize * 3;
        match positions.get(i..i + 3) {
            Some(p) => [p[0], p[1], p[2]],
            None => [f32::NAN; 3],
        }
    };
    let centre = |t: u32| -> [f32; 3] {
        let [a, b, c] = [0, 1, 2].map(|k| at(indices[t as usize * 3 + k]));
        let third = 1.0f32 / 3.0;
        [0, 1, 2].map(|k| (a[k] + b[k] + c[k]) * third)
    };
    let mut partitioner = Partitioner::new(count, max.saturating_sub(PART_SLACK), max);
    partitioner.locality_links(&mut islands, vertex_bounds(positions), centre);
    let graph = partitioner.graph(corners, LOCALITY_COST, |t, links| {
        for e in t as usize * 3..t as usize * 3 + 3 {
            for &(_, _, o) in opposite(e) {
                if o / 3 != t {
                    links.push((o / 3, SHARED_EDGE_COST));
                }
            }
        }
    });
    partitioner.partition(graph, fork);
    let (mut out, mut ends) = (Vec::with_capacity(indices.len()), Vec::new());
    for part in &partitioner.parts {
        let mut triangles = partitioner.ranks[part.clone()].to_vec();
        triangles.sort_unstable();
        for t in triangles {
            out.extend_from_slice(&indices[t as usize * 3..t as usize * 3 + 3]);
        }
        ends.push(out.len());
    }
    Clustered { indices: out, ends }
}

/// The edges running edge `e` back (`DirectedEdges::back`), `run_of` each edge's run.
fn opposite<'e>(edges: &'e DirectedEdges, run_of: &[u32], e: usize) -> &'e [(u32, u32, u32)] {
    match run_of[e] {
        u32::MAX => &[],
        run => edges
            .back(run as usize)
            .map_or(&[][..], |back| edges.run(back)),
    }
}

/// The box of every position, NaN aside: the bounds a partition's locality order is laid on
/// (`Partitioner::locality_links`); a point's at the origin when there is none.
pub fn vertex_bounds(positions: &[f32]) -> ([f32; 3], [f32; 3]) {
    let (low, high) = aabb_of_f32(positions.as_chunks::<3>().0.iter().copied());
    if low[0] > high[0] {
        return ([0.0; 3], [0.0; 3]);
    }
    (low, high)
}

/// The ordered clusters (`cluster`'s `keep_order`): the source order cut at the least cost among
/// the ranks that leave each side whole clusters of both caps.
fn cluster_in_order(positions: &[f32], indices: &[u32], caps: Caps) -> Clustered {
    let count = indices.len() / 3;
    let triangles = indices.as_chunks::<3>().0.iter();
    let (_, boxes) = centres_and_boxes(triangles.map(|t| t.map(|v| point(positions, v))));
    // Each corner's vertex numbered among those the triangles use, by first use: a cluster of a
    // large buffer's region costs its own size, never the buffer's.
    let (used, corners) = first_use(indices.iter().copied());
    let mut marks = Marks {
        corners: &corners,
        stamp: vec![0u32; used.len()],
        generation: 0,
    };
    let order: Vec<usize> = (0..count).collect();
    let (mut out, mut ends) = (Vec::with_capacity(indices.len()), Vec::new());
    // Each part with its count of distinct vertices, measured once: by the cut that made it.
    let held = marks.distinct(&order);
    let mut stack = vec![(0usize, count, held)];
    while let Some((from, to, held)) = stack.pop() {
        let n = to - from;
        let slice = &order[from..to];
        if n <= caps.triangles && held <= caps.vertices {
            (slice.iter()).for_each(|&t| out.extend_from_slice(&indices[t * 3..t * 3 + 3]));
            ends.push(out.len());
            continue;
        }
        // As few clusters as the caps allow: `k`, each side of the cut a whole number of them.
        let k = n
            .div_ceil(caps.triangles)
            .max(held.div_ceil(caps.vertices))
            .max(2);
        let at = cut_in_order(slice, &boxes, n.div_ceil(k));
        let (left, right) = (marks.distinct(&slice[..at]), marks.distinct(&slice[at..]));
        stack.push((from + at, to, right));
        stack.push((from, from + at, left));
    }
    Clustered { indices: out, ends }
}

/// The distinct vertices of triangles, by a stamp per vertex: counting a part costs its own size.
struct Marks<'c> {
    /// Three vertices a triangle, numbered among those the triangles use.
    corners: &'c [u32],
    stamp: Vec<u32>,
    generation: u32,
}
impl Marks<'_> {
    /// The distinct vertices of the triangles of `part`.
    fn distinct(&mut self, part: &[usize]) -> usize {
        self.generation += 1;
        let mut n = 0;
        for &t in part {
            for &v in &self.corners[t * 3..t * 3 + 3] {
                let mark = &mut self.stamp[v as usize];
                if *mark != self.generation {
                    *mark = self.generation;
                    n += 1;
                }
            }
        }
        n
    }
}

#[cfg(test)]
#[path = "clusters_tests.rs"]
mod tests;
