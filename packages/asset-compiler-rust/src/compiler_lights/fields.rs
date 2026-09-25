//! Fields of a glTF light, read one by one and mapped into what the engine contract accepts.
//! A missing, non-finite, or out-of-bounds field takes the default published in : the light
//! remains on, it does not disappear because an exporter wrote an impossible number.
use super::*;

pub(super) fn number(value: Option<&Value>, fallback: f64) -> f64 {
    value.and_then(Value::as_f64).unwrap_or(fallback)
}
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
pub(super) fn axis(m: &Mat4) -> Option<[f64; 3]> {
    let raw = [-m[8], -m[9], -m[10]];
    let length = crate::shared_math::length(raw);
    if !length.is_finite() || length <= 1e-9 {
        return None;
    }
    Some([raw[0] / length, raw[1] / length, raw[2] / length])
}
/// Declared range, otherwise the one imposed by intensity: the distance where irradiance of the strongest
/// channel drops below . Never infinite, never zero.
pub(super) fn range_of(light: &Value, radiant: f64, colour: [f64; 3]) -> f64 {
    if let Some(range) = light
        .get("range")
        .and_then(Value::as_f64)
        .filter(|r| r.is_finite() && *r > 0.0)
    {
        return range.min(MAX_RANGE);
    }
    let peak = radiant * colour[0].max(colour[1]).max(colour[2]);
    (peak / RANGE_CUTOFF_IRRADIANCE)
        .sqrt()
        .clamp(1e-3, MAX_RANGE)
}
/// Spot cone half-angle, mapped into the open interval accepted by the contract.
///  has no equivalent: the engine softens the edge using its own published setting.
pub(super) fn cone_of(light: &Value) -> f64 {
    let outer = number(light.pointer("/spot/outerConeAngle"), QUARTER_PI);
    if !outer.is_finite() {
        return QUARTER_PI;
    }
    outer.clamp(1e-3, std::f64::consts::FRAC_PI_2 - 1e-3)
}
