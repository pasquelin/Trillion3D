//! How far a deformed primitive can move, as the compiler writes it: the measure itself is the
//! shared codec's (`trillion3d_page_codec::reach`), which the run-time cut runs too.
use trillion3d_page_codec::encode::deformation::Deformation;
use trillion3d_page_codec::reach::{joint_balls, target_radius};

/// Whole-copy soft geometry names compact simulation vertices explicitly, without page streams.
pub fn reach_for_pass(d: &Deformation, positions: &[f32], whole: bool) -> serde_json::Value {
    let mut reach = reach(d, positions);
    if whole && d.soft_source.is_some() {
        reach["softSourceIds"] = serde_json::json!(d
            .skin
            .as_ref()
            .unwrap()
            .0
            .iter()
            .step_by(d.influences)
            .collect::<Vec<_>>());
    }
    reach
}

/// What the runtime inflates a deformed cluster's bounds by: for each joint the ball
/// of the rest-pose vertices it moves, `[x, y, z, radius]`, and each target's largest
/// displacement; `null` on a primitive that does not deform.
pub fn reach(d: &Deformation, positions: &[f32]) -> serde_json::Value {
    if d.skin.is_none() && d.targets.is_empty() {
        return serde_json::Value::Null;
    }
    let balls = match &d.skin {
        Some((joints, weights)) => joint_balls(positions, joints, weights, d.influences),
        None => Vec::new(),
    };
    let targets: Vec<f64> = d
        .targets
        .iter()
        .map(|t| target_radius(&t.position))
        .collect();
    let soft = d.soft_source.is_some();
    let mut reach = serde_json::json!({"joints": if soft { vec![] } else { balls.concat() }, "targets": targets, "softVertices": if soft { balls.len() } else { 0 }});
    // The kind the runtime draws by: a cloth is a sheet, seen from both sides.
    if let Some(kind) = d.soft_source {
        reach["softKind"] = serde_json::json!(kind);
    }
    reach
}
