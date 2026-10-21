//! The tree's walk (`trace`), the oracle's: its rays go every way, so each walks
//! `proxy::bvh`'s flattened tree.
use super::{triangle_hit, Hit, World};
use trillion3d_math::geometry::ray_box::{inverse, ray_aabb};

/// Whether the ray crosses node `node`'s box before `limit`: `ray_aabb` on its six stored bounds.
fn slab(world: &World, node: usize, origin: [f64; 3], inverse: [f64; 3], limit: f64) -> bool {
    let bound = |k: usize| world.node_bounds[node * 6 + k] as f64;
    ray_aabb(
        [bound(0), bound(1), bound(2)],
        [bound(3), bound(4), bound(5)],
        origin,
        inverse,
        limit,
    )
}

/// Closest hit triangle, or none; given `any`, the first found. The tree is walked in preorder, a
/// node's box tested against the best hit so far: a missed box or a finished leaf steps to the
/// rank past its subtree; a leaf tests its triangles in rank order, a hit kept when nearer than
/// the best. Traversal has no step bound here: the oracle pays whatever time it takes; it is the
/// engine that runs under budget.
pub fn trace(world: &World, origin: [f64; 3], ray: [f64; 3], limit: f64, any: bool) -> Hit {
    let mut best = Hit::none(limit);
    let count = world.node_links.len() / 3;
    let inverse = inverse(ray);
    let mut node = 0usize;
    while node < count {
        let link = node * 3;
        if !slab(world, node, origin, inverse, best.distance) {
            node = world.node_links[link] as usize;
            continue;
        }
        let triangles = world.node_links[link + 2] as usize;
        if triangles == 0 {
            node += 1;
            continue;
        }
        let first = world.node_links[link + 1] as usize;
        for slot in first..first + triangles {
            let Some((distance, barycentric)) =
                triangle_hit(world, slot, origin, ray, best.distance)
            else {
                continue;
            };
            best = Hit {
                distance,
                triangle: slot,
                found: true,
                barycentric,
            };
            if any {
                return best;
            }
        }
        node = world.node_links[link] as usize;
    }
    best
}
