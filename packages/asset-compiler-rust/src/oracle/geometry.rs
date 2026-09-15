//! Petite algèbre de vecteurs et lecture d'un triangle monde. Rien d'autre ne vit ici.
use super::scene::World;

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
    let base = triangle * 9 + corner * 3;
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
pub fn albedo_of(world: &World, triangle: usize) -> [f64; 3] {
    let packed = world.albedo[triangle];
    [
        (packed & 255) as f64 / 255.0,
        ((packed >> 8) & 255) as f64 / 255.0,
        ((packed >> 16) & 255) as f64 / 255.0,
    ]
}
