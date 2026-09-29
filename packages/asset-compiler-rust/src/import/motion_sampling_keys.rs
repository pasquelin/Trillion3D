//! Bezier control-hull subdivision retains source extrema and bounds each scalar curve's
//! deviation from its linear chord. Rotation travel is bounded across the whole hierarchy.
use super::*;

pub(super) fn times(stack: &ufbx::AnimStack) -> Result<Vec<f64>> {
    let mut times = contract::times(stack)?;
    let rotations = stack
        .layers
        .iter()
        .flat_map(|layer| layer.anim_props.iter())
        .filter(|prop| &*prop.prop_name == "Lcl Rotation")
        .map(|prop| prop.anim_value.curves.iter().flatten().count())
        .sum::<usize>()
        .max(1);
    for layer in &stack.layers {
        for prop in &layer.anim_props {
            let rotation = &*prop.prop_name == "Lcl Rotation";
            for curve in prop.anim_value.curves.iter().flatten() {
                for pair in curve.keyframes.windows(2) {
                    let (a, b) = (&pair[0], &pair[1]);
                    if b.time <= stack.time_begin || a.time >= stack.time_end {
                        continue;
                    }
                    let points = if a.interpolation == ufbx::Interpolation::Cubic {
                        [
                            [a.time, a.value],
                            [a.time + a.right.dx as f64, a.value + a.right.dy as f64],
                            [b.time - b.left.dx as f64, b.value - b.left.dy as f64],
                            [b.time, b.value],
                        ]
                    } else {
                        [
                            [a.time, a.value],
                            [a.time, a.value],
                            [b.time, b.value],
                            [b.time, b.value],
                        ]
                    };
                    let angular = if rotation {
                        15.0 / rotations as f64
                    } else {
                        f64::INFINITY
                    };
                    subdivide(points, angular, 0, stack, &mut times)?;
                }
            }
        }
    }
    contract::checked_times(times)
}

fn subdivide(
    p: [[f64; 2]; 4],
    angular: f64,
    depth: u32,
    stack: &ufbx::AnimStack,
    times: &mut Vec<f64>,
) -> Result<()> {
    let span = p[3][0] - p[0][0];
    if span <= 0.0
        || p.iter().flatten().any(|v| !v.is_finite())
        || p[1..3].iter().any(|q| q[0] < p[0][0] || q[0] > p[3][0])
    {
        return Err(contract::unsupported("FBX curve has invalid time controls"));
    }
    let slope = (p[3][1] - p[0][1]) / span;
    let deviation = p[1..3]
        .iter()
        .map(|q| (q[1] - p[0][1] - slope * (q[0] - p[0][0])).abs())
        .fold(0.0_f64, f64::max);
    let (min, max) = p
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), q| {
            (a.min(q[1]), b.max(q[1]))
        });
    if deviation <= ERROR * 0.25 && max - min <= angular {
        for point in [p[0], p[3]] {
            let time = point[0] - stack.time_begin;
            if time > 0.0 && time < stack.time_end - stack.time_begin {
                times.push(time);
            }
        }
        if times.len() > MAX_KEYS * 8 {
            return Err(contract::unsupported(
                "FBX source curves exceed the conversion key budget",
            ));
        }
        return Ok(());
    }
    if depth >= MAX_DEPTH {
        return Err(contract::unsupported(
            "FBX source curve cannot meet the interpolation bound",
        ));
    }
    // de Casteljau halves the time/value Bezier together; its control hull bounds the full curve.
    let mid = |a: [f64; 2], b: [f64; 2]| [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
    let (a, b, c) = (mid(p[0], p[1]), mid(p[1], p[2]), mid(p[2], p[3]));
    let (d, e) = (mid(a, b), mid(b, c));
    let f = mid(d, e);
    subdivide([p[0], a, d, f], angular, depth + 1, stack, times)?;
    subdivide([f, e, c, p[3]], angular, depth + 1, stack, times)
}
