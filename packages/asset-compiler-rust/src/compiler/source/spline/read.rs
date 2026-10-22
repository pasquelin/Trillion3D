//! The spline a node's `extras.splineMesh` names (`spline.rs`): each field read at the default of
//! the reference's spline mesh component, a refusal naming the field.
use super::bend::Bend;
use crate::*;

/// The readers of a spline's data: every refusal of it is `INVALID_SPLINE_MESH`.
pub(super) const SPLINE: Fields = Fields("INVALID_SPLINE_MESH");

/// The fields it may hold.
const FIELDS: [&str; 15] = [
    "startPos",
    "startTangent",
    "endPos",
    "endTangent",
    "startScale",
    "endScale",
    "startRoll",
    "endRoll",
    "startOffset",
    "endOffset",
    "splineUpDir",
    "smoothInterpRollScale",
    "forwardAxis",
    "boundaryMin",
    "boundaryMax",
];
/// The axes `forwardAxis` names, by their rank.
const AXES: [&str; 3] = ["x", "y", "z"];
/// A hundred centimetres, the reference's default length, in metres.
const LENGTH: f32 = 1.0;

type Spec = serde_json::Map<String, Value>;

/// The `N` numbers `key` names, `default` when the spec leaves it out.
fn vector<const N: usize>(
    spec: &Spec,
    key: &str,
    default: [f32; N],
    what: &str,
) -> Result<[f32; N]> {
    let name = format!("{what}.{key}");
    let named = SPLINE.optional(spec.get(key), &name, Fields::numbers::<N>)?;
    Ok(named.map_or(default, |numbers| numbers.map(|n| n as f32)))
}

/// The number `key` names, `default` when the spec leaves it out.
fn number(spec: &Spec, key: &str, default: f32, what: &str) -> Result<f32> {
    Ok(vector::<1>(spec, key, [default], what)?[0])
}

/// The axis `forwardAxis` names, x when the spec leaves it out.
fn forward_axis(spec: &Spec, what: &str) -> Result<usize> {
    let name = format!("{what}.forwardAxis");
    let named = SPLINE.optional(spec.get("forwardAxis"), &name, Fields::text)?;
    let Some(axis) = named else {
        return Ok(0);
    };
    let found = AXES.iter().position(|known| *known == axis);
    found.ok_or_else(|| SPLINE.bad(format!("{name} must be one of {}", AXES.join(", "))))
}

/// The bend a node's `extras.splineMesh` `spec` names, `what` naming it in a refusal.
pub(super) fn read_bend(spec: &Value, what: &str) -> Result<Bend> {
    let spec = SPLINE.known(spec, &FIELDS, what)?;
    let smooth_name = format!("{what}.smoothInterpRollScale");
    let smooth = SPLINE.optional(
        spec.get("smoothInterpRollScale"),
        &smooth_name,
        Fields::boolean,
    )?;
    Ok(Bend {
        start_pos: vector(spec, "startPos", [0.0; 3], what)?,
        start_tangent: vector(spec, "startTangent", [LENGTH, 0.0, 0.0], what)?,
        end_pos: vector(spec, "endPos", [LENGTH, 0.0, 0.0], what)?,
        end_tangent: vector(spec, "endTangent", [LENGTH, 0.0, 0.0], what)?,
        start_scale: vector(spec, "startScale", [1.0; 2], what)?,
        end_scale: vector(spec, "endScale", [1.0; 2], what)?,
        start_roll: number(spec, "startRoll", 0.0, what)?,
        end_roll: number(spec, "endRoll", 0.0, what)?,
        start_offset: vector(spec, "startOffset", [0.0; 2], what)?,
        end_offset: vector(spec, "endOffset", [0.0; 2], what)?,
        // Held within [-1, 1] on each axis, as the reference packs it for the shader.
        up: vector(spec, "splineUpDir", [0.0, 0.0, 1.0], what)?.map(|c| c.clamp(-1.0, 1.0)),
        smooth: smooth.unwrap_or(false),
        axis: forward_axis(spec, what)?,
        boundary: (
            number(spec, "boundaryMin", 0.0, what)?,
            number(spec, "boundaryMax", 0.0, what)?,
        ),
    })
}
