//! The spline a node's `extras.splineMesh` names (`spline.rs`): each field read at the default of
//! the reference's spline mesh component, a refusal naming the field.
use super::bend::Bend;
use crate::*;

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
const DEFAULT_LENGTH: f32 = 1.0;

pub(super) fn refused(what: &str, why: impl Display) -> CompilerError {
    CompilerError::new("INVALID_SPLINE_MESH", format!("{what}: {why}"))
}

/// The `N` numbers `key` names, `default` when the spec leaves it out.
fn vector<const N: usize>(
    spec: &serde_json::Map<String, Value>,
    key: &str,
    default: [f32; N],
    what: &str,
) -> Result<[f32; N]> {
    match spec.get(key).filter(|value| !value.is_null()) {
        None => Ok(default),
        Some(value) => {
            let numbers = GLTF.numbers::<N>(Some(value), &format!("{what}.{key}"))?;
            Ok(numbers.map(|n| n as f32))
        }
    }
}

/// The number `key` names, `default` when the spec leaves it out.
fn number(
    spec: &serde_json::Map<String, Value>,
    key: &str,
    default: f32,
    what: &str,
) -> Result<f32> {
    match spec.get(key).filter(|value| !value.is_null()) {
        None => Ok(default),
        Some(value) => Ok(GLTF.number(Some(value), &format!("{what}.{key}"))? as f32),
    }
}

/// The bend a node's `extras.splineMesh` `spec` names, `what` naming it in a refusal.
pub(super) fn read_bend(spec: &Value, what: &str) -> Result<Bend> {
    let spec = GLTF.known(spec, &FIELDS, what)?;
    let length = DEFAULT_LENGTH;
    let axis = match spec.get("forwardAxis").filter(|value| !value.is_null()) {
        None => 0,
        Some(value) => {
            let name = GLTF.text(Some(value), &format!("{what}.forwardAxis"))?;
            let found = AXES.iter().position(|axis| *axis == name);
            found.ok_or_else(|| refused(what, format!("forwardAxis must be one of {AXES:?}")))?
        }
    };
    let smooth = match spec.get("smoothInterpRollScale").filter(|v| !v.is_null()) {
        None => false,
        Some(value) => GLTF.boolean(Some(value), &format!("{what}.smoothInterpRollScale"))?,
    };
    Ok(Bend {
        start_pos: vector(spec, "startPos", [0.0; 3], what)?,
        start_tangent: vector(spec, "startTangent", [length, 0.0, 0.0], what)?,
        end_pos: vector(spec, "endPos", [length, 0.0, 0.0], what)?,
        end_tangent: vector(spec, "endTangent", [length, 0.0, 0.0], what)?,
        start_scale: vector(spec, "startScale", [1.0; 2], what)?,
        end_scale: vector(spec, "endScale", [1.0; 2], what)?,
        start_roll: number(spec, "startRoll", 0.0, what)?,
        end_roll: number(spec, "endRoll", 0.0, what)?,
        start_offset: vector(spec, "startOffset", [0.0; 2], what)?,
        end_offset: vector(spec, "endOffset", [0.0; 2], what)?,
        // Held within [-1, 1] on each axis, as the reference packs it for the shader.
        up: vector(spec, "splineUpDir", [0.0, 0.0, 1.0], what)?.map(|c| c.clamp(-1.0, 1.0)),
        smooth,
        axis,
        boundary: (
            number(spec, "boundaryMin", 0.0, what)?,
            number(spec, "boundaryMax", 0.0, what)?,
        ),
    })
}
