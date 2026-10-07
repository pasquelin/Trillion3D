use super::{OracleJob, OracleLight, KIND_SPOT, KIND_SUN, SPOT_EDGE};
use crate::proxy::tracer::{trace, World};
use rayon::prelude::*;
use trillion3d_math::vec3::{dot, scale, sub};

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
