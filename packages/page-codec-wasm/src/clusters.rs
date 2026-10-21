//! THE TRIANGLE CLUSTERER, one for the compiler's DAG levels and for the cuts the world makes at
//! run time (`wasm/clusters.rs`, in the page worker): indexed triangles in, clusters out.
//!
//! Free to reorder (an opaque cut, a cooked mesh), the clusters are the parts of the triangles'
//! graph (`partition_triangles`, by `partition.rs`): two triangles that run one edge between the
//! same two positions in opposite directions share it, at a heavy cost, and a triangle of a small
//! island also links its nearest triangles of other islands, at a cost of one, so the parts stay
//! compact across the gaps of a mesh in pieces. Parts of `max - 4` to `max` triangles, each a
//! patch of the surface whatever the index order, its triangles in the partition's order. The
//! vertex cap is no part of that cut: at encode, every cluster's triangles are laid in strips
//! (`strip.rs`), and a cluster whose strips name more vertices than the cap is halved there.
//!
//! Held to the source order (`keep_order`: the paint order of a blended surface, the coplanar
//! layer of lines and sprites), the cut is the rank of least cost along that order among those
//! that leave each side whole clusters: every cluster is a run of consecutive triangles in their
//! source order, as few as the caps allow, and a run that would reach across the mesh is cut where
//! it jumps. The result is the same on every build.
mod cut;
mod links;
pub mod strip;

use crate::edges::{position_key, weld_by};
use crate::encode::vertices::first_use;
use crate::partition::{Fork, Partitioner, Serial};
use crate::split::centres_and_boxes;
use cut::cut_in_order;
pub use links::{Linking, Links};
use trillion3d_math::geometry::aabb::aabb_of_f32;
use trillion3d_math::geometry::triangle::next_corner;
use trillion3d_math::join::{GreatestRoot, Join};
use trillion3d_math::vector::vec3::{point_checked, point_checked_f32};

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

/// The clusters of `indices` over `positions` (three `f32` a vertex), each within `caps`; with
/// `keep_order`, every cluster a run of the source order and the clusters in that order. Free,
/// the parts of the triangles' graph (`partition_triangles`, a source's links, within the box of
/// every position), each laid in strips and, its strips over the vertex cap, halved
/// (`strip::constrained`), the second half after every cluster.
pub fn cluster(positions: &[f32], indices: &[u32], caps: Caps, keep_order: bool) -> Clustered {
    if keep_order {
        return cluster_in_order(positions, indices, caps);
    }
    let bounds = vertex_bounds(positions);
    let limits = (caps.triangles, bounds);
    let (parts, _) = partition_triangles(positions, indices, limits, Linking::Source, &Serial, &[]);
    let (mut out, mut ends) = (Vec::with_capacity(indices.len()), Vec::new());
    let mut seconds = Vec::new();
    let mut start = 0;
    for &end in &parts.ends {
        let laid = strip::constrained(positions, &parts.indices[start..end], caps.vertices);
        out.extend_from_slice(&laid.first);
        ends.push(out.len());
        if let Some(second) = laid.second {
            seconds.push(second);
        }
        start = end;
    }
    for second in seconds {
        out.extend_from_slice(&second);
        ends.push(out.len());
    }
    Clustered { indices: out, ends }
}

/// The parts of the graph of the triangles of `indices`, of `max - 4` to `max` triangles
/// (`Partitioner`), each part's triangles in the partition's order, the parts in that order. A
/// triangle is joined, at `SHARED_EDGE_COST`, to the triangle of each edge linked to one of its
/// edges in order (`links.rs`, the way `linking` names): edges that run between the same two
/// positions in opposite directions; a triangle of a small island links its nearest triangles of
/// other islands at `LOCALITY_COST` (`Partitioner::locality_links`, by the centres of the
/// triangles within `bounds`). The halves of a large cut run on `fork`. A re-split of at most
/// `max` triangles is one part as it is; a source's, however small, is one part in the Morton
/// order of its triangles' centres, ties by rank.
///
/// Beside the parts, per corner of their triangles, the edges an edge carries out of its part:
/// the count `carried` holds for its corner (zero past its end), plus each link of its edge to a
/// triangle of another part, at most 255 — what the DAG carries from one cut to the next as the
/// edges its clusters share with others (`asset-compiler-rust/src/dag/clusters.rs`).
pub fn partition_triangles(
    positions: &[f32],
    indices: &[u32],
    (max, bounds): (usize, ([f32; 3], [f32; 3])),
    linking: Linking,
    fork: &dyn Fork,
    carried: &[u8],
) -> (Clustered, Vec<u8>) {
    let count = indices.len() / 3;
    let carried_at = |corner: usize| u32::from(carried.get(corner).copied().unwrap_or(0));
    if count == 0 || (count <= max && linking == Linking::Resplit) {
        let ends = if count == 0 { vec![] } else { vec![count * 3] };
        let outer = (0..count * 3).map(|c| carried_at(c) as u8).collect();
        let indices = indices[..count * 3].to_vec();
        return (Clustered { indices, ends }, outer);
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
    let ends = |e: usize| {
        (
            weld[indices[e] as usize],
            weld[indices[next_corner(e)] as usize],
        )
    };
    let corners = count * 3;
    let links = Links::of_ends(corners, ends, linking);
    let mut islands = Join::<GreatestRoot>::new(count);
    for e in 0..corners {
        links.each(e, |o| islands.unite((e / 3) as u32, o / 3));
    }
    let at = |v: u32| point_checked_f32(positions, v as usize).unwrap_or([f32::NAN; 3]);
    // Each triangle's centre, measured once: the locality links read it for every candidate.
    let centres: Vec<[f32; 3]> = (indices.as_chunks::<3>().0.iter())
        .map(|&tri| {
            let [a, b, c] = tri.map(at);
            let third = 1.0f32 / 3.0;
            [0, 1, 2].map(|k| (a[k] + b[k] + c[k]) * third)
        })
        .collect();
    let mut partitioner = Partitioner::new(count, max.saturating_sub(PART_SLACK), max);
    partitioner.locality_links(&mut islands, bounds, &centres);
    let graph = partitioner.graph(corners, LOCALITY_COST, |t, joined| {
        for e in t as usize * 3..t as usize * 3 + 3 {
            links.each(e, |o| joined.push((o / 3, SHARED_EDGE_COST)));
        }
    });
    partitioner.partition(graph, fork);
    let mut part_of = vec![0u32; count];
    for (p, part) in partitioner.parts.iter().enumerate() {
        (partitioner.ranks[part.clone()].iter()).for_each(|&t| part_of[t as usize] = p as u32);
    }
    let (mut out, mut ends) = (Vec::with_capacity(indices.len()), Vec::new());
    let mut outer = Vec::with_capacity(indices.len());
    for (p, part) in partitioner.parts.iter().enumerate() {
        for &t in &partitioner.ranks[part.clone()] {
            let t = t as usize * 3;
            out.extend_from_slice(&indices[t..t + 3]);
            for e in t..t + 3 {
                let mut n = carried_at(e);
                links.each(e, |o| n += u32::from(part_of[o as usize / 3] != p as u32));
                outer.push(n.min(255) as u8);
            }
        }
        ends.push(out.len());
    }
    (Clustered { indices: out, ends }, outer)
}

/// The box of every position, NaN aside: the bounds a partition's locality order is laid on
/// (`Partitioner::locality_links`); a point's at the origin when there is none.
pub fn vertex_bounds(positions: &[f32]) -> ([f32; 3], [f32; 3]) {
    box_or_point(positions.as_chunks::<3>().0.iter().copied())
}

/// `vertex_bounds` of the vertices `indices` name only, a vertex past the positions aside: a
/// mesh's own box when its buffer holds others' vertices too.
pub fn named_bounds(positions: &[f32], indices: &[u32]) -> ([f32; 3], [f32; 3]) {
    box_or_point((indices.iter()).filter_map(|&v| point_checked_f32(positions, v as usize)))
}

/// The box of `points`, NaN aside; a point's at the origin when there is none.
fn box_or_point(points: impl IntoIterator<Item = [f32; 3]>) -> ([f32; 3], [f32; 3]) {
    let (low, high) = aabb_of_f32(points);
    if low[0] > high[0] {
        return ([0.0; 3], [0.0; 3]);
    }
    (low, high)
}

/// The ordered clusters (`cluster`'s `keep_order`): the source order cut at the least cost among
/// the ranks that leave each side whole clusters of both caps.
fn cluster_in_order(positions: &[f32], indices: &[u32], caps: Caps) -> Clustered {
    let count = indices.len() / 3;
    if count == 0 {
        // No triangle, no cluster: as the free cut gives.
        return Clustered {
            indices: Vec::new(),
            ends: Vec::new(),
        };
    }
    // A cluster holds a triangle and its three vertices at least: the cut below never divides by
    // a cap of none, nor looks for a rank inside one triangle.
    let caps = Caps {
        triangles: caps.triangles.max(1),
        vertices: caps.vertices.max(3),
    };
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
mod tests;
