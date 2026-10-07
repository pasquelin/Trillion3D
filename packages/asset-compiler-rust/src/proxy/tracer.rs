//! The CPU ray tracer over `proxy::bvh`'s flattened tree, the only one on the Rust side: the
//! oracle traces the source scene with it (`oracle`), and the impostor bake the level-0 mesh
//! (`impostor`), through a hit filter that lets a ray through a cut texel.
use crate::proxy::PROXY_TRIANGLE_FLOATS;
use crate::shared_math::unit_where;
use trillion3d_math::vec3::{cross, dot, sub};

/// Triangles and their tree, with one word a triangle in the same order: the oracle's packed
/// linear albedo (the source scene in world space, re-read without cuts, simplification or
/// proxy), the bake's material (one mesh in object space).
pub struct World {
    pub triangles: Vec<f32>,
    pub tags: Vec<u32>,
    pub node_bounds: Vec<f32>,
    pub node_links: Vec<u32>,
}

/// `a` at unit length, or `a` itself when its length is not positive. The oracle's own guard: a
/// NaN or infinite length still divides, as the oracle always has.
pub fn normalise(a: [f64; 3]) -> [f64; 3] {
    unit_where(a, |norm| norm > 0.0 || norm.is_nan()).unwrap_or(a)
}
pub fn vertex(world: &World, triangle: usize, corner: usize) -> [f64; 3] {
    let base = triangle * PROXY_TRIANGLE_FLOATS + corner * 3;
    [
        world.triangles[base] as f64,
        world.triangles[base + 1] as f64,
        world.triangles[base + 2] as f64,
    ]
}
pub fn normal_of(world: &World, triangle: usize) -> [f64; 3] {
    let a = vertex(world, triangle, 0);
    normalise(cross(
        sub(vertex(world, triangle, 1), a),
        sub(vertex(world, triangle, 2), a),
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
    let normal = if dot(facing, ray) > 0.0 {
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

fn slab(world: &World, node: usize, origin: [f64; 3], inverse: [f64; 3], limit: f64) -> bool {
    let base = node * 6;
    let mut entry = 0.0f64;
    let mut exit = limit;
    for axis in 0..3 {
        let low = (world.node_bounds[base + axis] as f64 - origin[axis]) * inverse[axis];
        let high = (world.node_bounds[base + 3 + axis] as f64 - origin[axis]) * inverse[axis];
        entry = entry.max(low.min(high));
        exit = exit.min(low.max(high));
    }
    entry <= exit
}

/// Ray-triangle test by barycentric coordinates, double-sided: a wall has no front or back for light.
fn triangle_hit(
    world: &World,
    triangle: usize,
    origin: [f64; 3],
    ray: [f64; 3],
    limit: f64,
) -> (f64, [f64; 2]) {
    let miss = (limit, [0.0; 2]);
    let a = vertex(world, triangle, 0);
    let edge0 = sub(vertex(world, triangle, 1), a);
    let edge1 = sub(vertex(world, triangle, 2), a);
    let perpendicular = cross(ray, edge1);
    let determinant = dot(edge0, perpendicular);
    if determinant.abs() < 1e-12 {
        return miss;
    }
    let inverse = 1.0 / determinant;
    let offset = sub(origin, a);
    let u = dot(offset, perpendicular) * inverse;
    if !(0.0..=1.0).contains(&u) {
        return miss;
    }
    let across = cross(offset, edge0);
    let v = dot(ray, across) * inverse;
    if v < 0.0 || u + v > 1.0 {
        return miss;
    }
    let distance = dot(edge1, across) * inverse;
    if distance <= 1e-4 || distance >= limit {
        return miss;
    }
    (distance, [u, v])
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
