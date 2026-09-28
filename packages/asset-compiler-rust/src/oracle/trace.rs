use super::geometry::vertex;
use super::scene::World;
use super::{OracleJob, OracleLight, KIND_SPOT, KIND_SUN, SPOT_EDGE};
use crate::shared_math::{cross, dot, scale, sub};
use rayon::prelude::*;

/// What a ray hit: distance, and triangle. No stack, no recursion.
pub struct Hit {
    pub distance: f64,
    pub triangle: usize,
    pub found: bool,
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

/// Möller–Trumbore, double-sided: a wall has no front or back for light.
fn triangle_hit(
    world: &World,
    triangle: usize,
    origin: [f64; 3],
    ray: [f64; 3],
    limit: f64,
) -> f64 {
    let a = vertex(world, triangle, 0);
    let edge0 = sub(vertex(world, triangle, 1), a);
    let edge1 = sub(vertex(world, triangle, 2), a);
    let perpendicular = cross(ray, edge1);
    let determinant = dot(edge0, perpendicular);
    if determinant.abs() < 1e-12 {
        return limit;
    }
    let inverse = 1.0 / determinant;
    let offset = sub(origin, a);
    let u = dot(offset, perpendicular) * inverse;
    if !(0.0..=1.0).contains(&u) {
        return limit;
    }
    let across = cross(offset, edge0);
    let v = dot(ray, across) * inverse;
    if v < 0.0 || u + v > 1.0 {
        return limit;
    }
    let distance = dot(edge1, across) * inverse;
    if distance <= 1e-4 || distance >= limit {
        return limit;
    }
    distance
}

/// Closest hit triangle, or none. Traversal has no step bound here: the oracle
/// pays whatever time it takes; it is the engine that runs under budget.
pub fn trace(world: &World, origin: [f64; 3], ray: [f64; 3], limit: f64, any: bool) -> Hit {
    let mut best = Hit {
        distance: limit,
        triangle: 0,
        found: false,
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
            let distance = triangle_hit(world, slot, origin, ray, best.distance);
            if distance < best.distance {
                best = Hit {
                    distance,
                    triangle: slot,
                    found: true,
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

/// Irradiance of declared lights at a point: same physical attenuation and cones
/// as the shader, with ray-traced shadows on source triangles instead of shadow maps.
pub fn direct(world: &World, lights: &[OracleLight], point: [f64; 3], n: [f64; 3]) -> [f64; 3] {
    let mut total = [0.0f64; 3];
    let offset = [
        point[0] + n[0] * 1e-3,
        point[1] + n[1] * 1e-3,
        point[2] + n[2] * 1e-3,
    ];
    for light in lights {
        let (to_light, attenuation, span) = if light.kind == KIND_SUN {
            (scale(light.direction, -1.0), 1.0, f64::INFINITY)
        } else {
            let away = sub(light.position, point);
            let distance = dot(away, away).sqrt();
            if distance >= light.range {
                continue;
            }
            let unit = scale(away, 1.0 / distance.max(1e-9));
            let ratio = distance / light.range;
            let window = (1.0 - ratio.powi(4)).clamp(0.0, 1.0).powi(2);
            let mut value = window / (distance * distance).max(1e-4);
            if light.kind == KIND_SPOT {
                let cosine = dot(scale(unit, -1.0), light.direction);
                let edge = light.cos_cone;
                let t = ((cosine - edge) / SPOT_EDGE).clamp(0.0, 1.0);
                value *= t * t * (3.0 - 2.0 * t);
            }
            (unit, value, distance)
        };
        let cosine = dot(n, to_light);
        if attenuation <= 0.0 || cosine <= 0.0 {
            continue;
        }
        if light.casts_shadow {
            let reach = if span.is_finite() {
                span
            } else {
                scene_reach(world)
            };
            if trace(world, offset, to_light, reach, true).found {
                continue;
            }
        }
        for (axis, channel) in total.iter_mut().enumerate() {
            *channel += light.color[axis] * light.intensity * attenuation * cosine;
        }
    }
    total
}

/// The range that a ray without own distance — e.g. a sun light — must travel: scene diagonal,
/// which necessarily crosses it.
pub fn scene_reach(world: &World) -> f64 {
    let bounds = &world.node_bounds;
    if bounds.len() < 6 {
        return 1.0;
    }
    let side = |axis: usize| (bounds[3 + axis] - bounds[axis]) as f64;
    (side(0) * side(0) + side(1) * side(1) + side(2) * side(2)).sqrt()
}

/// Returns the indirect irradiance image, one line per task. Each pixel has its own seed, so
/// the same image comes out of the same job, regardless of thread count.
pub fn render(job: &OracleJob, world: &World) -> Vec<f32> {
    let mut image = vec![0.0f32; job.width * job.height * 3];
    image
        .par_chunks_mut(job.width * 3)
        .enumerate()
        .for_each(|(y, row)| super::rays::render_row(job, world, y, row));
    image
}
