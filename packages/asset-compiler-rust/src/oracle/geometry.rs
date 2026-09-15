//! Petite algèbre de vecteurs et lecture d'un triangle monde. Rien d'autre ne vit ici.
use super::scene::World;
use super::trace::Hit;
use crate::proxy::PROXY_TRIANGLE_FLOATS;

pub fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn scale(a: [f64; 3], k: f64) -> [f64; 3] {
    [a[0] * k, a[1] * k, a[2] * k]
}
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
/// Le point qu'un rayon a touché et la normale qui le regarde. La source n'a pas de sens
/// d'enroulement fiable : c'est le rayon qui décide de quel côté de la surface il arrive.
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
