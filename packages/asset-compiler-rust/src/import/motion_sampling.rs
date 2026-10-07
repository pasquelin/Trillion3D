//! Adaptive source evaluation: original keys remain, including the playback endpoints.
//! Every accepted interval checks the emitted LINEAR/SLERP values against ufbx at three interior
//! points. A source angular-sweep cap prevents whole turns aliasing to an unchanged quaternion.
use super::*;
use trillion3d_math::scalar::mix;

/// Component error at validation samples: metres for unit-scale translations, relative above
/// one; scale/weight components and sign-invariant quaternion components use the same bound.
pub(super) const ERROR: f64 = 1e-6;
const MAX_KEYS: usize = 36_000;
const MAX_DEPTH: u32 = 24;

pub(super) struct Pose {
    pub(super) parts: [Vec<f64>; 3],
    pub(super) weights: Vec<f32>,
}
pub(super) struct Sample {
    pub(super) time: f64,
    pub(super) poses: Vec<Pose>,
}

fn evaluate(
    scene: &ufbx::Scene,
    stack: &ufbx::AnimStack,
    nodes: &[Written<'_>],
    time: f64,
) -> Result<Sample> {
    let evaluated = ufbx::evaluate_scene(
        scene,
        &stack.anim,
        stack.time_begin + time,
        Default::default(),
    )
    .map_err(|e| import_error(&e))?;
    let poses = nodes
        .iter()
        .map(|node| {
            let placed = &evaluated.nodes[node.typed];
            let matrix = if node.geometry {
                &placed.geometry_to_world
            } else {
                &placed.node_to_world
            };
            if node.pose {
                contract::matrix(matrix)?;
            }
            let weights = node
                .channels
                .iter()
                .map(|(channel, key)| {
                    evaluated.blend_channels[channel.element.typed_id as usize].keyframes[*key]
                        .effective_weight as f32
                })
                .collect();
            Ok(Pose {
                parts: trs(matrix),
                weights,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Sample { time, poses })
}

fn quaternion(values: &[f64]) -> ufbx::Quat {
    ufbx::Quat {
        x: values[0] as f32 as f64,
        y: values[1] as f32 as f64,
        z: values[2] as f32 as f64,
        w: values[3] as f32 as f64,
    }
}

/// Measures the actual emitted float32 endpoints, rather than unrounded source endpoints.
fn error(a: &Sample, b: &Sample, actual: &Sample) -> f64 {
    let t = (actual.time - a.time as f32 as f64) / (b.time as f32 as f64 - a.time as f32 as f64);
    let mut worst = 0.0_f64;
    let mut component = |actual: f64, expected: f64| {
        worst = if actual.is_finite() && expected.is_finite() {
            worst.max((actual - expected).abs() / actual.abs().max(1.0))
        } else {
            f64::INFINITY
        };
    };
    for ((a, b), actual) in a.poses.iter().zip(&b.poses).zip(&actual.poses) {
        for part in [0, 2] {
            for ((&a, &b), &actual) in a.parts[part]
                .iter()
                .zip(&b.parts[part])
                .zip(&actual.parts[part])
            {
                component(actual, mix(a as f32 as f64, b as f32 as f64, t));
            }
        }
        let expected = ufbx::quat_slerp(quaternion(&a.parts[1]), quaternion(&b.parts[1]), t);
        let sign = if ufbx::quat_dot(expected, quaternion(&actual.parts[1])) < 0.0 {
            -1.0
        } else {
            1.0
        };
        for (&actual, expected) in actual.parts[1]
            .iter()
            .zip([expected.x, expected.y, expected.z, expected.w])
        {
            component(actual * sign, expected);
        }
        for ((&a, &b), &actual) in a.weights.iter().zip(&b.weights).zip(&actual.weights) {
            component(actual as f64, mix(a as f64, b as f64, t));
        }
    }
    worst
}

pub(super) fn sample(
    scene: &ufbx::Scene,
    stack: &ufbx::AnimStack,
    nodes: &[Written<'_>],
    check: impl Fn() -> Result<()>,
) -> Result<Vec<Sample>> {
    let times = sampling_keys::times(stack)?;
    let mut output = vec![evaluate(scene, stack, nodes, times[0])?];
    for &time in &times[1..] {
        let end = evaluate(scene, stack, nodes, time)?;
        let mut pending = vec![(end, 0)];
        while let Some((end, depth)) = pending.pop() {
            check()?;
            let start = output.last().unwrap();
            let middle = evaluate(scene, stack, nodes, (start.time + end.time) * 0.5)?;
            let mut worst = error(start, &end, &middle);
            for t in [0.25, 0.75] {
                let point = evaluate(
                    scene,
                    stack,
                    nodes,
                    start.time + (end.time - start.time) * t,
                )?;
                worst = worst.max(error(start, &end, &point));
            }
            if worst <= ERROR * 0.25 {
                output.push(end);
            } else {
                if depth >= MAX_DEPTH
                    || middle.time as f32 <= start.time as f32
                    || middle.time as f32 >= end.time as f32
                {
                    return Err(contract::unsupported("FBX animation cannot meet the declared interpolation error at float32 time precision"));
                }
                pending.push((end, depth + 1));
                pending.push((middle, depth + 1));
            }
            if output.len() + pending.len() > MAX_KEYS {
                return Err(contract::unsupported(
                    "FBX animation exceeds the bounded conversion key budget",
                ));
            }
        }
    }
    Ok(output)
}

#[path = "motion_sampling_keys.rs"]
mod sampling_keys;
#[cfg(test)]
#[path = "motion_sampling_tests.rs"]
mod tests;
