//! Walking the encoded nodes finds the nearest triangle that brute force finds.
use super::{decode, node_of, soup, wide_of, Decoded};
use crate::ray_tracing::abi::{
    RAY_TRACING_LEAF_COUNT_SHIFT, RAY_TRACING_LEAF_OFFSET_MASK, RAY_TRACING_WIDTH,
};
use crate::ray_tracing::cut::CutTriangle;
use crate::ray_tracing::wide::Wide;
use crate::tests::random::Xorshift;
use trillion3d_math::geometry::ray_box::{inverse, ray_span};
use trillion3d_math::geometry::triangle::ray_triangle;

/// The nearest hit of the ray among the triangles `ids` of `triangles`: its distance and rank.
fn nearest_of(
    triangles: &[CutTriangle],
    ids: impl Iterator<Item = usize>,
    ray: ([f64; 3], [f64; 3]),
    best: &mut Option<(f64, usize)>,
) {
    for id in ids {
        let corners = triangles[id].corners.map(|c| c.map(f64::from));
        let limit = best.map_or(f64::INFINITY, |(t, _)| t);
        if let Some((t, _)) = ray_triangle(ray.0, ray.1, corners, (0.0, limit)) {
            *best = Some((t, id));
        }
    }
}

/// The nearest hit found by walking the encoded nodes.
fn walked(
    triangles: &[CutTriangle],
    wide: &Wide,
    nodes: &[Decoded],
    ray: ([f64; 3], [f64; 3]),
) -> Option<(f64, usize)> {
    let line = (ray.0, inverse(ray.1));
    let mut best = None;
    let mut stack = vec![0];
    while let Some(at) = stack.pop() {
        let node = &nodes[at];
        for slot in 0..RAY_TRACING_WIDTH {
            let meta = node.metas[slot];
            let inner = (node.mask >> slot) & 1 == 1;
            if meta == 0 && !inner {
                continue;
            }
            let limit = best.map_or(f64::INFINITY, |(t, _)| t);
            if ray_span(node.child_box(slot), line, (0.0, limit)).is_none() {
                continue;
            }
            if inner {
                let before = node.mask & ((1u8 << slot) - 1);
                stack.push(node.child_base + before.count_ones() as usize);
            } else {
                let count = usize::from(meta >> RAY_TRACING_LEAF_COUNT_SHIFT);
                let first = node.triangle_base + usize::from(meta & RAY_TRACING_LEAF_OFFSET_MASK);
                nearest_of(
                    triangles,
                    wide.triangles[first..first + count].iter().copied(),
                    ray,
                    &mut best,
                );
            }
        }
    }
    best
}

#[test]
fn walking_the_nodes_finds_the_nearest_triangle_brute_force_finds() {
    let triangles = soup(500, 0xbeef);
    let wide = wide_of(&triangles);
    let nodes: Vec<Decoded> = wide.nodes.iter().map(|n| decode(&node_of(n))).collect();
    let mut rng = Xorshift::new(77);
    let mut hits = 0;
    for _ in 0..2000 {
        let origin = [0; 3].map(|_| f64::from(rng.unit()) * 20.0 - 5.0);
        let target = [0; 3].map(|_| f64::from(rng.unit()) * 10.0);
        let ray = [0, 1, 2].map(|axis| target[axis] - origin[axis]);
        let ray = (origin, ray);
        let mut brute = None;
        nearest_of(&triangles, 0..triangles.len(), ray, &mut brute);
        let found = walked(&triangles, &wide, &nodes, ray);
        assert_eq!(found.map(|(t, _)| t), brute.map(|(t, _)| t));
        hits += usize::from(brute.is_some());
    }
    assert!(hits > 100, "the rays hit something: {hits}");
}
