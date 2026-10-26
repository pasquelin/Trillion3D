//! Radius of the envelope surrounding a light: what the contract accepts.
//!
//! A real light sits in something — glass, a reflector, a lampshade — and this
//! envelope is geometry like any other: it enters its own light's shadow map
//! and darkens it. `emitterRadius`, written on `point` and `spot` lights only, declares the radius
//! of the sphere that this light, and only this light, stops shadowing: the radius the source
//! declares on the light, and no other.
use super::*;

/// A radius failing the contract — non-finite, zero, negative, or beyond range — is
/// counted under this name and the field remains absent: an envelope larger than range is no longer
/// an envelope, and excluding beyond range would reject shadow casters that the envelope does not contain.
const INVALID: &str = "light-emitter-radius-invalid";

/// Writes `emitterRadius` on an already converted light, when the source declares one satisfying
/// the contract. A directional light has neither position nor range: the field is refused without count,
/// since no sphere can sit around a light source having no center.
pub(super) fn attach(entry: &mut Value, light: &Value, counts: &mut Tally) {
    let (Some(range), Some(radius)) = (entry.get("range").and_then(Value::as_f64), declared(light))
    else {
        return;
    };
    if !(radius.is_finite() && radius > 0.0 && radius < range) {
        *counts.entry(INVALID).or_insert(0) += 1;
        return;
    }
    entry["emitterRadius"] = json!(radius);
}

/// The radius declared by the source on the light itself. It travels in the light's
/// `extras.emitterRadius`, where the USD and Blender drivers write theirs: a format whose light
/// carries a radius puts it there, and no second channel is opened for it. Its value is in
/// meters, like the rest of the scene.
fn declared(light: &Value) -> Option<f64> {
    light
        .pointer("/extras/emitterRadius")
        .and_then(Value::as_f64)
}
