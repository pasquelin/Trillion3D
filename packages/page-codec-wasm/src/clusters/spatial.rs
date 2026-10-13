//! The spatial rule: a recursive bisection of the triangles into as few clusters as the caps allow.
//! A group too large for one cluster is cut at the rank that leaves each side a whole number of
//! clusters, `⌊k/2⌋` of the `k` it needs on the left, on the axis of least cost
//! (`split::bisect_least_cost`): each side's count times the square of its sphere. A cluster is
//! a compact patch whatever the index order: a soup, a grid listed by columns, a strip. A side is
//! a set fixed by the order of `split` (coordinate, then identifier), never by how a selection
//! arranges it, and a cluster lists its triangles in their source order: the result is the same on
//! every build. `O(T log T)` for `T` triangles, whatever the size of the vertex buffer.
use super::{point, Caps};
use crate::encode::vertices::first_use;
use crate::split::bisect_least_cost;
use trillion3d_math::aabb::aabb_of;
use trillion3d_math::scalar::mean;

/// The clusters of a triangle list: its triangles in cluster order, and where each cluster ends,
/// in indices.
pub struct Clustered {
    pub indices: Vec<u32>,
    pub ends: Vec<usize>,
}

/// The clusters of `indices` over `positions` (three `f32` a vertex) by the spatial rule, each
/// within `caps`, its triangles in their source order.
pub fn spatial(positions: &[f32], indices: &[u32], caps: Caps) -> Clustered {
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
        let k = n
            .div_ceil(caps.triangles)
            .max(held.div_ceil(caps.vertices))
            .max(2);
        let at = ((n * (k / 2) + k / 2) / k).clamp(1, n - 1);
        bisect_least_cost(slice, &centres, |t| boxes[t], at);
        stack.push((from + at, to));
        stack.push((from, from + at));
    }
    Clustered { indices: out, ends }
}
