//! What a coarse level certifies: the one-sided Hausdorff distance from the surface it draws to
//! the surface it replaced, in object units.
//!
//! The two numbers this strategy produces are not the same number, and they are kept apart here.
//! The attribute quadric — normals, texture coordinates, colours, weighed — chooses **which edge
//! collapses** and is what keeps the seams (Garland & Heckbert, *Simplifying Surfaces with Color
//! and Texture using Quadric Error Metrics*, 1998); it belongs to the simplifier, and the weights
//! must change nothing of what a level claims.
//!
//! What meshoptimizer hands back cannot be that claim. Its error is accumulated over the
//! collapses, `solveQuadrics` moves every survivor afterwards and no error is recomputed, so the
//! displacement it just applied is not in the number. And the number is a weighed mean of squared
//! point-to-**plane** distances: a vertex sliding past the extent of its triangles keeps a plane
//! distance near zero while genuinely leaving the surface, so it is an average, never a bound.
//!
//! Measured here instead, on the geometry as the solve left it:
//! `E = max over samples s of the simplified surface of min over source triangles T of d(s, T)`.
//! Each simplified triangle is sampled at its three corners, its three edge midpoints and its
//! centroid; the minimum is a real point-to-triangle distance over the group's source triangles,
//! so sliding inside the surface costs nothing and leaving it costs what it left by, whether the
//! collapses or the solve did it. Monotonicity up the DAG is the builder's (`reduce.rs`), which
//! never lets a parent claim less than its children.
use crate::proxy::bvh::{build, Node};
use crate::proxy::PROXY_TRIANGLE_FLOATS;
use crate::shared_math::{cross, dot, length, sub};

/// Barycentric weights of the samples taken on each simplified triangle: the three corners, the
/// three edge midpoints and the centroid. Corners alone would miss a triangle that spans a fold
/// the source had; the midpoints and the centre are where such a triangle is furthest out.
const SAMPLES: [[f64; 3]; 7] = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
    [0.5, 0.5, 0.0],
    [0.0, 0.5, 0.5],
    [0.5, 0.0, 0.5],
    [1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0],
];

/// Distance from the simplified surface to the source surface, in the units of the positions.
/// Zero when every sample of the simplified surface lies on a source triangle.
pub(crate) fn one_sided_hausdorff(
    source_positions: &[f32],
    source_triangles: &[u32],
    positions: &[f32],
    triangles: &[u32],
) -> f64 {
    let mut soup = Vec::with_capacity(source_triangles.len() * 3);
    for &corner in source_triangles {
        soup.extend_from_slice(&source_positions[corner as usize * 3..corner as usize * 3 + 3]);
    }
    // `build` reorders a parallel colour per triangle beside the soup; this surface carries none.
    let mut unused = vec![0u32; source_triangles.len() / 3];
    let nodes = build(&mut soup, &mut unused);
    if nodes.is_empty() {
        return 0.0;
    }
    let mut worst = 0.0f64;
    let mut stack = Vec::with_capacity(64);
    for corners in triangles.as_chunks::<3>().0 {
        let corners = corners.map(|corner| point(positions, corner));
        for weights in SAMPLES {
            let sample = std::array::from_fn(|k| {
                corners[0][k] * weights[0] + corners[1][k] * weights[1] + corners[2][k] * weights[2]
            });
            worst = worst.max(nearest(&soup, &nodes, sample, worst, &mut stack));
        }
    }
    worst
}

/// Distance from a point to the nearest source triangle. `floor` is the worst distance already
/// certified: a subtree that cannot beat it changes nothing, and once the point is known to be
/// closer than it the search stops — only the maximum over samples is read.
fn nearest(
    soup: &[f32],
    nodes: &[Node],
    sample: [f64; 3],
    floor: f64,
    stack: &mut Vec<usize>,
) -> f64 {
    let mut best = f64::INFINITY;
    stack.clear();
    stack.push(0);
    while let Some(at) = stack.pop() {
        if best <= floor {
            break;
        }
        let node = &nodes[at];
        if box_distance(node, sample) >= best {
            continue;
        }
        if node.leaf() {
            for slot in node.first..node.first + node.count {
                best = best.min(triangle_distance(soup, slot, sample));
            }
        } else {
            let (left, right) = (at + 1, node.right);
            let near = box_distance(&nodes[left], sample) <= box_distance(&nodes[right], sample);
            stack.push(if near { right } else { left });
            stack.push(if near { left } else { right });
        }
    }
    best
}

/// Distance from a point to a node's box: zero inside it, and a lower bound on the distance to
/// every triangle the subtree holds.
fn box_distance(node: &Node, sample: [f64; 3]) -> f64 {
    let outside: [f64; 3] = std::array::from_fn(|k| {
        (node.low[k] as f64 - sample[k])
            .max(sample[k] - node.high[k] as f64)
            .max(0.0)
    });
    length(outside)
}

/// Distance from a point to one triangle of the soup, its closest point taken over the face, the
/// three edges and the three corners.
fn triangle_distance(soup: &[f32], slot: usize, sample: [f64; 3]) -> f64 {
    let base = slot * PROXY_TRIANGLE_FLOATS;
    let corners: [[f64; 3]; 3] =
        std::array::from_fn(|c| std::array::from_fn(|k| soup[base + c * 3 + k] as f64));
    let mut best = f64::INFINITY;
    for c in 0..3 {
        best = best.min(length(sub(sample, corners[c])));
        let edge = sub(corners[(c + 1) % 3], corners[c]);
        let square = dot(edge, edge);
        if square > 0.0 {
            let t = (dot(sub(sample, corners[c]), edge) / square).clamp(0.0, 1.0);
            let on: [f64; 3] = std::array::from_fn(|k| corners[c][k] + edge[k] * t);
            best = best.min(length(sub(sample, on)));
        }
    }
    let span = cross(sub(corners[1], corners[0]), sub(corners[2], corners[0]));
    let Some(normal) = unit(span) else {
        return best;
    };
    let off = dot(sub(sample, corners[0]), normal);
    let on: [f64; 3] = std::array::from_fn(|k| sample[k] - normal[k] * off);
    if inside(&corners, normal, on) {
        best = best.min(off.abs());
    }
    best
}

/// Whether a point of the triangle's plane falls within its three edges.
fn inside(corners: &[[f64; 3]; 3], normal: [f64; 3], on: [f64; 3]) -> bool {
    (0..3).all(|c| {
        let edge = sub(corners[(c + 1) % 3], corners[c]);
        dot(cross(edge, sub(on, corners[c])), normal) >= 0.0
    })
}

fn point(buffer: &[f32], vertex: u32) -> [f64; 3] {
    let at = vertex as usize * 3;
    std::array::from_fn(|k| buffer[at + k] as f64)
}
/// The unit vector, or `None` when there is no direction to read.
fn unit(a: [f64; 3]) -> Option<[f64; 3]> {
    let length = length(a);
    (length > 0.0).then(|| a.map(|k| k / length))
}

#[cfg(test)]
#[path = "qem_attributes_hausdorff_tests.rs"]
mod tests;
