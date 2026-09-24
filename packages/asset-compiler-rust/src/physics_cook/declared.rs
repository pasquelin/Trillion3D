//! The matter a source declares for a node's collider (`KHR_physics_rigid_bodies`): the friction and
//! restitution of the `physicsMaterial` its collider names. Nothing is guessed: a node that names
//! none carries none, and the runtime gives its tiles the engine's default matter.
use serde_json::{json, Value};

/// `friction` and `restitution` the collider of node `node` declares, each only when declared.
pub(crate) fn declared_matter(g: &Value, node: &Value) -> Value {
    let material = node
        .pointer("/extensions/KHR_physics_rigid_bodies/collider/physicsMaterial")
        .and_then(Value::as_u64)
        .and_then(|m| {
            g.pointer(&format!(
                "/extensions/KHR_physics_rigid_bodies/physicsMaterials/{m}"
            ))
        });
    let mut matter = json!({});
    for (key, from) in [
        ("friction", "dynamicFriction"),
        ("restitution", "restitution"),
    ] {
        if let Some(value) = material.and_then(|m| m.get(from)).and_then(Value::as_f64) {
            matter[key] = json!(value);
        }
    }
    matter
}
