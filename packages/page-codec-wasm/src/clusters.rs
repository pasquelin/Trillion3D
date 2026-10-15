//! THE TRIANGLE CLUSTERER, one for the compiler's DAG levels and for the cuts the world makes at
//! run time (`wasm_clusters.rs`, in the page worker): indexed triangles in, clusters of at most
//! `Caps` out, by one recursive bisection.
//!
//! A group too large for one cluster is cut in two at the least cost: each side's count times the
//! squared diagonal of its triangles' boxes, the square of the sphere every cull draws it with.
//! Free to reorder (an opaque cut, a cooked mesh), the cut is the median on the axis of least cost
//! (`split::bisect_least_cost`), at the rank that leaves each side a whole number of clusters: as
//! few clusters as the caps allow, each a compact patch whatever the index order. Held to the
//! source order (`keep_order`: the paint order of a blended surface, the coplanar layer of lines
//! and sprites), the cut is the rank of least cost along that order among those that leave each
//! side whole clusters: every cluster is a run of consecutive triangles, as few as the caps allow,
//! and a run that would reach across the mesh is cut where it jumps.
//! A cluster lists its triangles in their source order; the result is the same on every build.
//! `O(T log T)` for `T` triangles, whatever the size of the vertex buffer.
use crate::encode::vertices::first_use;
use crate::split::bisect_least_cost;
use trillion3d_math::aabb::aabb_of;
use trillion3d_math::scalar::mean;
use trillion3d_math::vec3::point_checked;
use trillion3d_math::vecn::distance2;

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

type Box3 = ([f64; 3], [f64; 3]);

/// The clusters of `indices` over `positions` (three `f32` a vertex), each within `caps`, its
/// triangles in their source order; with `keep_order`, every cluster a run of the source order and
/// the clusters in that order.
pub fn cluster(positions: &[f32], indices: &[u32], caps: Caps, keep_order: bool) -> Clustered {
    let count = indices.len() / 3;
    let mut boxes = Vec::with_capacity(count);
    let mut centres = Vec::with_capacity(count);
    for tri in indices.as_chunks::<3>().0 {
        let corners = tri.map(|v| point(positions, v));
        boxes.push(aabb_of(corners));
        centres.push([0, 1, 2].map(|k| mean(corners.map(|p| p[k]))));
    }
    // Each corner's vertex numbered among those the triangles use, by first use: a cluster of a
    // large buffer's region costs its own size, never the buffer's.
    let (used, corners) = first_use(indices.iter().copied());
    let (mut stamp, mut generation) = (vec![0u32; used.len()], 0u32);
    let mut distinct = |part: &[usize]| {
        generation += 1;
        let mut n = 0;
        for &t in part {
            for &v in &corners[t * 3..t * 3 + 3] {
                let mark = &mut stamp[v as usize];
                n += (*mark != generation) as usize;
                *mark = generation;
            }
        }
        n
    };
    let mut order: Vec<usize> = (0..count).collect();
    let (mut out, mut ends) = (Vec::with_capacity(indices.len()), Vec::new());
    let mut stack = vec![(0usize, count)];
    while let Some((from, to)) = stack.pop() {
        let (n, held) = (to - from, distinct(&order[from..to]));
        let slice = &mut order[from..to];
        if n <= caps.triangles && held <= caps.vertices {
            slice.sort_unstable();
            slice
                .iter()
                .for_each(|&t| out.extend_from_slice(&indices[t * 3..t * 3 + 3]));
            ends.push(out.len());
            continue;
        }
        // As few clusters as the caps allow: `k`, each side of the cut a whole number of them.
        let k = n
            .div_ceil(caps.triangles)
            .max(held.div_ceil(caps.vertices))
            .max(2);
        let at = if keep_order {
            cut_in_order(slice, &boxes, n.div_ceil(k))
        } else {
            let at = ((n * (k / 2) + k / 2) / k).clamp(1, n - 1);
            bisect_least_cost(slice, &centres, |t| boxes[t], at);
            at
        };
        stack.push((from + at, to));
        stack.push((from, from + at));
    }
    Clustered { indices: out, ends }
}

/// The rank, in `part`'s own order, that cuts it in two at the least cost — each side's count times
/// the squared diagonal of its boxes — among the multiples of `unit`, the size of a whole cluster:
/// the runs stay as few as the caps allow, and the cut still falls where the order jumps. A cost
/// no number can say keeps the middle multiple.
fn cut_in_order(part: &[usize], boxes: &[Box3], unit: usize) -> usize {
    let join = |(low, high): Box3, (l, h): Box3| -> Box3 {
        (
            [0, 1, 2].map(|k| low[k].min(l[k])),
            [0, 1, 2].map(|k| high[k].max(h[k])),
        )
    };
    let empty: Box3 = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    let n = part.len();
    let mut after = vec![empty; n + 1];
    for i in (0..n).rev() {
        after[i] = join(after[i + 1], boxes[part[i]]);
    }
    let unit = unit.clamp(1, n - 1);
    let middle = (n / 2 / unit).max(1) * unit;
    let (mut before, mut best) = (empty, (f64::INFINITY, middle.min(n - 1)));
    for at in 1..n {
        before = join(before, boxes[part[at - 1]]);
        if !at.is_multiple_of(unit) {
            continue;
        }
        let side = |count: usize, (low, high): Box3| count as f64 * distance2(high, low);
        let cost = side(at, before) + side(n - at, after[at]);
        if cost < best.0 {
            best = (cost, at);
        }
    }
    best.1
}

#[cfg(test)]
#[path = "clusters_tests.rs"]
mod tests;
