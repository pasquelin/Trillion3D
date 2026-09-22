//! Small vector algebra and world triangle reading. Nothing else lives here.
use super::scene::World;
use super::trace::Hit;
use crate::proxy::PROXY_TRIANGLE_FLOATS;

use crate::shared_math::{cross, dot, scale, sub};
pub fn normalise(a: [f64; 3]) -> [f64; 3] {
    let length = dot(a, a).sqrt();
    if length <= 0.0 {
        a
    } else {
        scale(a, 1.0 / length)
    }
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
/// ray determines which surface side it arrives at.
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
        scale(facing, -1.0)
    } else {
        facing
    };
    (point, normal)
}
pub fn albedo_of(world: &World, triangle: usize) -> [f64; 3] {
    let packed = world.albedo[triangle];
    [
        (packed & 255) as f64 / 255.0,
        ((packed >> 8) & 255) as f64 / 255.0,
        ((packed >> 16) & 255) as f64 / 255.0,
    ]
}
