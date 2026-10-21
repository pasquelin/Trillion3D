//! The spatial queries over a triangle soup, on the one tree the compiler builds over triangles
//! (`trillion3d_page_codec::proxy::bvh`) — the tree a capture's rays walk on the GPU too
//! (`gpu/walk.wgsl`) —: whether a ray escapes, the first triangle it stops at, and the nearest
//! point of the triangles.
//! The queries over the tree live in `queries`.
use crate::trace::surface::Traceable;
use trillion3d_math::geometry::aabb::point_box_distance2;
use trillion3d_math::geometry::ray_box::ray_aabb;
use trillion3d_math::vector::vec3::point;
use trillion3d_math::vector::vecn::{add, scale};
use trillion3d_page_codec::proxy::bvh::{build_ordered, Node};
mod queries;

/// A tree over triangles: its nodes in preorder, and its leaves' triangles in leaf order, each
/// named by its rank in the soup it was built from (`order`).
pub(crate) struct Tree<T = Vec<f32>> {
    pub nodes: Vec<Node>,
    /// Nine floats per triangle, in leaf order.
    pub triangles: T,
    /// Per leaf slot, the triangle's rank in the soup.
    pub order: Vec<usize>,
}

/// `sources`' triangles, materials and corners reordered into the leaf order of the tree built on
/// them, in place of a copy: the tree's nodes, each slot then its triangle's rank. Its primitives'
/// ranges are left as they were: a bake's sources hold none (`sources::traceable`).
pub(crate) fn order_sources(sources: &mut Traceable) -> Vec<Node> {
    let world = &mut sources.world;
    let (nodes, order) = build_ordered(&mut world.triangles, &mut world.tags);
    let mut corners = std::mem::take(&mut sources.corners);
    sources.corners = (order.iter())
        .map(|&rank| std::mem::take(&mut corners[rank]))
        .collect();
    nodes
}

/// Corner `corner` of the triangle at leaf slot `slot`.
fn corner(triangles: &[f32], slot: usize, corner: usize) -> [f64; 3] {
    point(triangles, (slot * 3 + corner) as u32)
}

/// The squared distance from `point` to `node`'s box: what the nearest walk prunes a node by
/// (`closest`).
fn box_distance2(node: &Node, point: [f64; 3]) -> f64 {
    point_box_distance2(node.low.map(f64::from), node.high.map(f64::from), point)
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
pub(crate) fn triangle_of(positions: &[f32], indices: &[u32], t: usize) -> [[f64; 3]; 3] {
    [0, 1, 2].map(|k| point(positions, indices[t * 3 + k]))
}

/// The points of a flat `x, y, z` position array, each widened to `f64`.
pub(crate) fn points_of(positions: &[f32]) -> Vec<[f64; 3]> {
    positions
        .as_chunks::<3>()
        .0
        .iter()
        .map(|p| p.map(f64::from))
        .collect()
}

/// The triangles of a flat index array, each corner a point rank.
pub(crate) fn triangles_of(indices: &[u32]) -> Vec<[usize; 3]> {
    indices
        .as_chunks::<3>()
        .0
        .iter()
        .map(|t| t.map(|v| v as usize))
        .collect()
}

/// The soup of an indexed mesh: nine floats per triangle.
pub(crate) fn soup(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    indices
        .iter()
        .flat_map(|&v| {
            let v = v as usize;
            [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]
        })
        .collect()
}
