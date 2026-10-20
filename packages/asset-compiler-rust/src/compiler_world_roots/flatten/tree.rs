//! The bake's spatial queries over a triangle soup, on the one tree the compiler builds over
//! triangles (`trillion3d_page_codec::proxy::bvh`): the nearest hit of a ray a filter accepts —
//! the sample a ray along the normal reads (`bake::project`) —, whether a ray escapes, whether a
//! point lies within a per-triangle distance — the shell a thin part is thickened by —, and the
//! nearest point of the triangles.
//! The queries over the tree live in `queries`.
use crate::surface_trace::Traceable;
use trillion3d_math::ray_box::ray_aabb;
use trillion3d_math::vec3::point;
use trillion3d_math::vecn::{add, scale};
use trillion3d_page_codec::proxy::bvh::{build_ordered, Node};
mod queries;

/// A tree over triangles: its nodes in preorder, and its leaves' triangles in leaf order, owned
/// or borrowed, each named by its rank in the soup it was built from (`order`).
pub(crate) struct Tree<T = Vec<f32>> {
    pub nodes: Vec<Node>,
    /// Nine floats per triangle, in leaf order.
    pub triangles: T,
    /// Per leaf slot, the triangle's rank in the soup; empty when each slot is its own rank
    /// (`order_sources`).
    pub order: Vec<usize>,
}

/// `sources`' triangles, materials and corners reordered into the leaf order of the tree built on
/// them, in place of a copy: the tree's nodes, each slot then its triangle's rank (`Tree::over`),
/// and per slot the rank its triangle had before. Its primitives' ranges are left as they were: a
/// bake's sources hold none (`sources::traceable`).
pub(super) fn order_sources(sources: &mut Traceable) -> (Vec<Node>, Vec<usize>) {
    let world = &mut sources.world;
    let (nodes, order) = build_ordered(&mut world.triangles, &mut world.tags);
    let mut corners = std::mem::take(&mut sources.corners);
    sources.corners = (order.iter())
        .map(|&rank| std::mem::take(&mut corners[rank]))
        .collect();
    (nodes, order)
}

impl<'a> Tree<&'a [f32]> {
    /// The tree `nodes` over `sources` as `order_sources` left them, their triangles borrowed.
    pub fn over(nodes: Vec<Node>, sources: &'a Traceable) -> Self {
        Self {
            nodes,
            triangles: &sources.world.triangles,
            order: Vec::new(),
        }
    }
}

/// Corner `corner` of the triangle at leaf slot `slot`.
fn corner(triangles: &[f32], slot: usize, corner: usize) -> [f64; 3] {
    point(triangles, (slot * 3 + corner) as u32)
}

/// The squared distance from `point` to `node`'s box, its sides pushed out by `widen` one unit in
/// the last place of single precision: what the nearest walk prunes a node by (`nearest_within`).
fn box_distance2(node: &Node, point: [f64; 3], widen: bool) -> f64 {
    (0..3)
        .map(|k| {
            let (low, high) = (f64::from(node.low[k]), f64::from(node.high[k]));
            let slack = if widen {
                f64::from(f32::EPSILON) * low.abs().max(high.abs())
            } else {
                0.0
            };
            let d = (low - slack - point[k])
                .max(0.0)
                .max(point[k] - high - slack);
            d * d
        })
        .sum::<f64>()
}

/// How far along the line `origin + t·ray`, `inverse` its direction's reciprocal, the nearest
/// point of `node`'s box lies from the origin, `|t|`, on either side — zero when the origin's
/// part of the line crosses it —, `None` when the line misses it: the slab test, each axis in
/// order, a NaN distance passed over by `min` and `max` (`ray_aabb`).
fn line_distance(node: &Node, origin: [f64; 3], inverse: [f64; 3]) -> Option<f64> {
    let (mut entry, mut exit) = (f64::NEG_INFINITY, f64::INFINITY);
    for axis in 0..3 {
        let near = (f64::from(node.low[axis]) - origin[axis]) * inverse[axis];
        let far = (f64::from(node.high[axis]) - origin[axis]) * inverse[axis];
        entry = entry.max(near.min(far));
        exit = exit.min(near.max(far));
    }
    if entry > exit {
        None
    } else if entry > 0.0 {
        Some(entry)
    } else if exit < 0.0 {
        Some(-exit)
    } else {
        Some(0.0)
    }
}

/// Whether `origin + t·ray`, `inverse` its direction's reciprocal, crosses `node`'s box for `t`
/// in `[from, to]`: the slab test from the point at `from`.
fn crosses(
    node: &Node,
    (origin, ray, inverse): ([f64; 3], [f64; 3], [f64; 3]),
    (from, to): (f64, f64),
) -> bool {
    let start = add(origin, scale(ray, from));
    ray_aabb(
        node.low.map(f64::from),
        node.high.map(f64::from),
        start,
        inverse,
        to - from,
    )
}

impl Tree {
    /// The tree of `soup`, nine floats per triangle, taken: its triangles reordered into leaf
    /// order in place of a copy.
    pub fn from_soup(mut triangles: Vec<f32>) -> Self {
        let mut tags = vec![0u32; triangles.len() / 9];
        let (nodes, order) = build_ordered(&mut triangles, &mut tags);
        Self {
            nodes,
            triangles,
            order,
        }
    }
}

/// The triangle `t` of an indexed mesh, its corners as `f64`.
pub(super) fn triangle_of(positions: &[f32], indices: &[u32], t: usize) -> [[f64; 3]; 3] {
    [0, 1, 2].map(|k| point(positions, indices[t * 3 + k]))
}

/// The soup of an indexed mesh: nine floats per triangle.
pub(super) fn soup(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    indices
        .iter()
        .flat_map(|&v| {
            let v = v as usize;
            [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]
        })
        .collect()
}
