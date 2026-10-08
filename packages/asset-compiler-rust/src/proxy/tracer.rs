//! The CPU ray tracer over `proxy::bvh`'s flattened tree, the only one on the Rust side: the
//! oracle traces the source scene with it (`oracle`), and the impostor bake the level-0 mesh
//! (`impostor`), through a hit filter that lets a ray through a cut texel.
use crate::proxy::PROXY_TRIANGLE_FLOATS;
use trillion3d_math::aabb::ray_aabb;
use trillion3d_math::triangle::{ray_triangle, triangle_cross};
use trillion3d_math::vec3::unit_or_itself;

/// Triangles and their tree, with one word a triangle in the same order: the oracle's packed
/// linear albedo (the source scene in world space, re-read without cuts, simplification or
/// proxy), the bake's material (one mesh in object space).
pub struct World {
    pub triangles: Vec<f32>,
    pub tags: Vec<u32>,
    pub node_bounds: Vec<f32>,
    pub node_links: Vec<u32>,
}

pub fn vertex(world: &World, triangle: usize, corner: usize) -> [f64; 3] {
    trillion3d_math::vec3::point(
        &world.triangles[triangle * PROXY_TRIANGLE_FLOATS..],
        corner as u32,
    )
}
pub fn normal_of(world: &World, triangle: usize) -> [f64; 3] {
    let a = vertex(world, triangle, 0);
    unit_or_itself(triangle_cross(
        a,
        vertex(world, triangle, 1),
        vertex(world, triangle, 2),
    ))
}
/// Hit point and facing normal. Source has no reliable winding order:
/// ray determines which surface side it arrives at. The oracle's alone: compiled with it.
#[cfg(any(test, feature = "oracle"))]
pub fn surface_at(
    world: &World,
    origin: [f64; 3],
    ray: [f64; 3],
    hit: &Hit,
) -> ([f64; 3], [f64; 3]) {
    let point = [
        origin[0] + ray[0] * hit.distance,
        origin[1] + ray[1] * hit.distance,
        origin[2] + ray[2] * hit.distance,
    ];
    let facing = normal_of(world, hit.triangle);
    let normal = if trillion3d_math::vec3::dot(facing, ray) > 0.0 {
        trillion3d_math::vec3::scale(facing, -1.0)
    } else {
        facing
    };
    (point, normal)
}
/// What a ray hit: distance, triangle and the hit's barycentric `(u, v)` on it. No stack, no
/// recursion.
pub struct Hit {
    pub distance: f64,
    pub triangle: usize,
    pub found: bool,
    pub barycentric: [f64; 2],
}

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

/// Ray-triangle test by barycentric coordinates, double-sided: a wall has no front or back for light.
fn triangle_hit(
    world: &World,
    triangle: usize,
    origin: [f64; 3],
    ray: [f64; 3],
    limit: f64,
) -> (f64, [f64; 2]) {
    let corners = [0, 1, 2].map(|corner| vertex(world, triangle, corner));
    ray_triangle(origin, ray, corners, (1e-4, limit)).unwrap_or((limit, [0.0; 2]))
}

/// Closest hit triangle, or none. Traversal has no step bound here: the oracle
/// pays whatever time it takes; it is the engine that runs under budget.
#[cfg(any(test, feature = "oracle"))]
pub fn trace(world: &World, origin: [f64; 3], ray: [f64; 3], limit: f64, any: bool) -> Hit {
    trace_where(world, (origin, ray), limit, any, &|_, _| true)
}

/// `trace`, keeping only the hits `keep` accepts from their triangle and barycentric `(u, v)`:
/// a masked leaf lets the ray through where its texel is cut (the impostor bake).
pub fn trace_where(
    world: &World,
    (origin, ray): ([f64; 3], [f64; 3]),
    limit: f64,
    any: bool,
    keep: &dyn Fn(usize, [f64; 2]) -> bool,
) -> Hit {
    let mut best = Hit {
        distance: limit,
        triangle: 0,
        found: false,
        barycentric: [0.0; 2],
    };
    let count = world.node_links.len() / 3;
    let inverse = [
        1.0 / if ray[0].abs() < 1e-20 { 1e-20 } else { ray[0] },
        1.0 / if ray[1].abs() < 1e-20 { 1e-20 } else { ray[1] },
        1.0 / if ray[2].abs() < 1e-20 { 1e-20 } else { ray[2] },
    ];
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
            let (distance, barycentric) = triangle_hit(world, slot, origin, ray, best.distance);
            if distance < best.distance && keep(slot, barycentric) {
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
        }
        node = world.node_links[link] as usize;
    }
    best
}
