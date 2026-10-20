//! The CPU ray tracer, the only one on the Rust side. The oracle traces the source scene
//! (`oracle`), its rays going every way, by walking `proxy::bvh`'s flattened tree (`walk`); the
//! voxels trace the level-0 mesh (`surface_trace`), each ray against the triangles that overlap its
//! voxel (`among`), through a hit filter that lets a ray through a cut texel.
use trillion3d_math::triangle::{ray_triangle, triangle_cross};
use trillion3d_math::vec3::unit_or_itself;
use trillion3d_page_codec::proxy::PROXY_TRIANGLE_FLOATS;

mod among;
pub use among::Among;
#[cfg(any(test, feature = "oracle"))]
mod walk;
#[cfg(any(test, feature = "oracle"))]
pub use walk::trace;

/// Triangles, with one word a triangle in the same order: the oracle's packed linear albedo (the
/// source scene in world space, re-read without cuts, simplification or proxy), the bake's
/// material (one mesh in object space). The oracle's walk has their tree too.
#[derive(Default)]
pub struct World {
    pub triangles: Vec<f32>,
    pub tags: Vec<u32>,
    #[cfg(any(test, feature = "oracle"))]
    pub node_bounds: Vec<f32>,
    #[cfg(any(test, feature = "oracle"))]
    pub node_links: Vec<u32>,
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
    let normal = if trillion3d_math::vecn::dot(facing, ray) > 0.0 {
        trillion3d_math::vecn::scale(facing, -1.0)
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

impl Hit {
    /// No hit yet, before `limit`.
    fn none(limit: f64) -> Self {
        Self {
            distance: limit,
            triangle: 0,
            found: false,
            barycentric: [0.0; 2],
        }
    }
}

/// Ray-triangle test by barycentric coordinates, double-sided: a wall has no front or back for
/// light. Its distance does not depend on `limit`, which only refuses a hit at or past it.
fn triangle_hit(
    world: &World,
    triangle: usize,
    origin: [f64; 3],
    ray: [f64; 3],
    limit: f64,
) -> Option<(f64, [f64; 2])> {
    let corners = [0, 1, 2].map(|corner| vertex(world, triangle, corner));
    ray_triangle(origin, ray, corners, (1e-4, limit))
}
