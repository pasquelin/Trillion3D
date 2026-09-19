//! What a prefab instance replaces: values of a local transform, and a renderer's material slots.
//!
//! Each override names the property it targets by its serialized path — `m_LocalPosition.x`,
//! `m_LocalRotation.w`, `m_LocalScale.y`, `m_Materials.Array.data[2]` — and replaces only that
//! one: the others keep what the source prefab declares. It is therefore the source transform,
//! override by override, that enters the axis conversion, never a transform rebuilt from scratch.
use super::*;

/// Material slots at most in a renderer. An index beyond that describes no renderer the editor
/// could have written: it is counted under this name, never reserved.
pub(super) const MAX_SLOTS: usize = 1 << 16;
pub(super) const SLOT_INVALID: &str = "unity-prefab-material-slot-invalid";

/// What a prefab instance replaces, by property path.
pub(super) type Overrides = HashMap<String, f64>;

/// Local transform, as Unity writes it, once instance overrides have been applied and then the
/// axis conversion done.
pub(super) fn local_trs(body: &Yaml, overrides: &Overrides) -> Trs {
    let at = |path: &str, value: f64| overrides.get(path).copied().unwrap_or(value);
    let position = vec3(&body["m_LocalPosition"], [0.0, 0.0, 0.0]);
    let rotation = vec4(
        &body["m_LocalRotation"],
        ["x", "y", "z", "w"],
        [0., 0., 0., 1.],
    );
    let scale = vec3(&body["m_LocalScale"], [1.0, 1.0, 1.0]);
    Trs::from_unity(
        [
            at("m_LocalPosition.x", position[0]),
            at("m_LocalPosition.y", position[1]),
            at("m_LocalPosition.z", position[2]),
        ],
        [
            at("m_LocalRotation.x", rotation[0]),
            at("m_LocalRotation.y", rotation[1]),
            at("m_LocalRotation.z", rotation[2]),
            at("m_LocalRotation.w", rotation[3]),
        ],
        [
            at("m_LocalScale.x", scale[0]),
            at("m_LocalScale.y", scale[1]),
            at("m_LocalScale.z", scale[2]),
        ],
    )
}

/// Extends the slot list to `len`, the new slots unnamed.
pub(super) fn cover(slots: &mut Vec<Option<Ref>>, len: usize) {
    if slots.len() < len {
        slots.resize(len, None);
    }
}

/// `m_Materials.Array.data[2]` names the renderer's third material slot.
pub(super) fn material_slot(path: &str) -> Option<usize> {
    path.strip_prefix("m_Materials.Array.data[")?
        .strip_suffix(']')?
        .parse::<usize>()
        .ok()
}
