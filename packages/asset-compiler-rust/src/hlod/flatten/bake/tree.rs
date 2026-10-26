//! The spatial queries over a triangle soup, on the one tree the compiler builds over triangles
//! (`trillion3d_page_codec::proxy::bvh`) — the tree the rays of a capture and of a merged atlas's
//! translucent texels walk on the GPU (`gpu/walk.wgsl`), whose nodes the packers read —: whether a
//! ray escapes, the nearest triangle a ray meets, the nearest point of the triangles.
//! The queries over the tree live in `queries`.
use crate::trace::surface::Traceable;
use trillion3d_math::geometry::aabb::point_box_distance2;
use trillion3d_math::geometry::ray_box::ray_span;
use trillion3d_math::vector::vec3::point;
use trillion3d_page_codec::proxy::bvh::{build_ordered, Node};
mod queries;
#[cfg(test)]
mod tests;

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
/// them, in place of a copy: the tree's nodes, and per leaf slot its triangle's rank before. Its
/// primitives' ranges are left as they were: a bake's sources hold none (`sources::traceable`).
pub(crate) fn order_sources(sources: &mut Traceable) -> (Vec<Node>, Vec<usize>) {
    let world = &mut sources.world;
    let (nodes, order) = build_ordered(&mut world.triangles, &mut world.tags);
    let mut corners = std::mem::take(&mut sources.corners);
    sources.corners = (order.iter())
        .map(|&rank| std::mem::take(&mut corners[rank]))
        .collect();
    (nodes, order)
}

/// Corner `corner` of the triangle at leaf slot `slot`.
fn corner(triangles: &[f32], slot: usize, corner: usize) -> [f64; 3] {
    point(triangles, (slot * 3 + corner) as u32)
}

/// The squared distance from `point` to `node`'s box: what the nearest walk prunes a node by
/// (`nearest`).
fn box_distance2(node: &Node, point: [f64; 3]) -> f64 {
    point_box_distance2(node.low.map(f64::from), node.high.map(f64::from), point)
}

/// Where `origin + t·ray`, `inverse` its direction's reciprocal (`ray_box::inverse`), first meets
/// `node`'s box for `t` in `[from, to]`: that `t`, none when the ray misses the box there
/// (`ray_span`).
fn entered(node: &Node, line: ([f64; 3], [f64; 3]), range: (f64, f64)) -> Option<f64> {
    ray_span(
        (node.low.map(f64::from), node.high.map(f64::from)),
        line,
        range,
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
