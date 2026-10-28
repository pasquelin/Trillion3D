//! Fields of a glTF light, read one by one and mapped into what the engine contract accepts.
//! A missing, non-finite, or out-of-bounds field takes the default published in : the light
//! remains on, it does not disappear because an exporter wrote an impossible number.
use super::*;
use crate::compiler::validate::number_or;
use trillion3d_math::vector::vec3::normalize_where;

/// Linear glTF color, constrained to finite non-negative channels.
pub(super) fn colour_of(light: &Value) -> [f64; 3] {
    let items = light.get("color").and_then(Value::as_array);
    let channel = |i: usize| {
        items
            .and_then(|c| c.get(i))
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite() && *v >= 0.0)
            .unwrap_or(1.0)
    };
    [channel(0), channel(1), channel(2)]
}
/// Emission axis of a glTF light: the node's −Z in world space, normalized. This is the direction
/// of light propagation, exactly what the contract expects from a spot light and the sun.
pub(crate) fn axis(m: &Mat4) -> Option<[f64; 3]> {
    let raw = [-m[8], -m[9], -m[10]];
    normalize_where(raw, |norm| norm.is_finite() && norm > 1e-9)
}
/// The node's +Y axis in world space, normalised: the up a light profile's horizontal angles are laid out from.
pub(crate) fn up_axis(m: &Mat4) -> Option<[f64; 3]> {
    normalize_where([m[4], m[5], m[6]], |norm| norm.is_finite() && norm > 1e-9)
}
/// Declared range in metres, otherwise `UNBOUNDED_RANGE`: a punctual light that names none reaches
/// everywhere, as glTF defines it. A declared range is kept as written, with no ceiling.
pub(super) fn range_of(light: &Value) -> f64 {
    light
        .get("range")
        .and_then(Value::as_f64)
        .filter(|r| r.is_finite() && *r > 0.0)
        .unwrap_or(UNBOUNDED_RANGE)
}
/// A directional light's shadow distance that fails the contract — neither a finite number of
/// metres of at least 0, `true` nor `false` — is counted under this name and the field stays absent:
/// the light keeps the default.
const INVALID_SHADOW_DISTANCE: &str = "light-shadow-distance-invalid";
/// Writes `shadowDistance` on an already converted light, when the glTF light's `extras` name one:
/// a finite number of metres of at least 0, `false` for none (0); `true`, the default, and `null`
/// name nothing. A light that is no sun has no shadow distance (`SceneLight`): the field is refused
/// without count, since nothing was tried.
pub(super) fn attach_shadow_distance(entry: &mut Value, light: &Value, counts: &mut Tally) {
    if entry.get("kind").and_then(Value::as_str) != Some("directional") {
        return;
    }
    let Some(named) = light.pointer("/extras/shadowDistance") else {
        return;
    };
    match named {
        Value::Bool(true) | Value::Null => {}
        Value::Bool(false) => entry["shadowDistance"] = json!(0.0),
        other => match other.as_f64().filter(|d| d.is_finite() && *d >= 0.0) {
            Some(distance) => entry["shadowDistance"] = json!(distance),
            None => *counts.entry(INVALID_SHADOW_DISTANCE).or_insert(0) += 1,
        },
    }
}
/// Spot cone half-angles, inner then outer, mapped into the intervals accepted by the contract: the
/// outer one in the open interval, the inner one from 0 up to the widest cone. A cone the source
/// does not name, or names badly, takes its default: 0 and π/4.
pub(super) fn cone_of(light: &Value) -> (f64, f64) {
    let angle =
        |name: &str, default: f64| number_or(light.pointer(&format!("/spot/{name}")), default);
    (
        angle("innerConeAngle", 0.0).clamp(0.0, SPOT_CONE_MAX),
        angle("outerConeAngle", QUARTER_PI).clamp(SPOT_CONE_MIN, SPOT_CONE_MAX),
    )
}
