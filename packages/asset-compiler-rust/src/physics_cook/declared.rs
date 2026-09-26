//! What a source declares for a node through `KHR_physics_rigid_bodies` and `KHR_implicit_shapes`.
//! Nothing is guessed: the friction and restitution of the `physicsMaterial` its collider names,
//! when it names one (a node that names none carries none, and the runtime gives its tiles the
//! engine's default matter); and, for a node declaring motion, the body it is: its motion as
//! declared, its shape — the implicit shape it names, the hull of the mesh it names, or, with no
//! shape, a convex decomposition of its own mesh (`hulls.rs`) weighed here, at cook time.
use super::hulls::cooked_hulls;
use super::stage::{place, trs};
use super::PHYSICS_COOK_FAILED;
use crate::compiler_validate::{required_index, values};
use crate::compiler_world::Mat4;
use crate::{CompilerError, Options, Result};
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

fn refused(message: String) -> CompilerError {
    CompilerError::new(PHYSICS_COOK_FAILED, message)
}

/// An implicit shape as the runtime builds it: half extents, radii, half heights; the
/// extension's defaults where a size is not given.
fn implicit(shape: &Value) -> Result<Value> {
    let number = |path: &str, default: f64| {
        shape
            .pointer(path)
            .and_then(Value::as_f64)
            .unwrap_or(default)
    };
    let kind = shape.get("type").and_then(Value::as_str).unwrap_or("");
    Ok(match kind {
        "box" => {
            let half: Vec<f64> = (0..3)
                .map(|k| number(&format!("/box/size/{k}"), 1.0) * 0.5)
                .collect();
            json!({"type":"box","halfExtents":half})
        }
        "sphere" => json!({"type":"sphere","radius":number("/sphere/radius", 0.5)}),
        "capsule" | "cylinder" => {
            let top = number(&format!("/{kind}/radiusTop"), 0.25);
            let bottom = number(&format!("/{kind}/radiusBottom"), 0.25);
            let height = number(&format!("/{kind}/height"), 0.5);
            json!({"type":kind,"halfHeight":height * 0.5,"radius":top.max(bottom)})
        }
        other => {
            return Err(refused(format!(
                "A body's implicit shape \"{other}\" is not one the runtime builds."
            )))
        }
    })
}

/// The shape of a body declaring `declared` on node `index`: the implicit shape it names, else the
/// cooked hulls of the mesh its collider names (its own without a collider), one hull when the
/// collider asks for its convex hull.
fn body_shape(
    o: &Options,
    (g, bin): (&Value, &[u8]),
    index: usize,
    declared: &Value,
) -> Result<Value> {
    let geometry = declared.pointer("/collider/geometry");
    if let Some(id) = geometry
        .and_then(|g| g.get("shape"))
        .and_then(Value::as_u64)
    {
        let shape = g.pointer(&format!("/extensions/KHR_implicit_shapes/shapes/{id}"));
        return implicit(shape.ok_or_else(|| {
            refused(format!(
                "A body's collider names shape {id}, which is missing."
            ))
        })?);
    }
    let at = geometry
        .and_then(|g| g.get("node"))
        .and_then(Value::as_u64)
        .map_or(index, |n| n as usize);
    let owner = values(g, "nodes")?.get(at).ok_or_else(|| {
        refused(format!(
            "A body's collider names node {at}, which is missing."
        ))
    })?;
    let Some(mesh) = owner.get("mesh") else {
        return Err(refused(format!(
            "A body's collider names node {at}, which has no mesh."
        )));
    };
    let hull = geometry
        .and_then(|g| g.get("convexHull"))
        .and_then(Value::as_bool)
        == Some(true);
    cooked_hulls(o, (g, bin), required_index(Some(mesh), "node.mesh")?, hull)
}

/// The rigid bodies the nodes `chosen` declare, placed by their `world` matrices: each declaring
/// node's `physics.json` entry — its `motion` as declared, its `shape`, its matter and pose — and
/// the report's refusals (`node`, `reason`). A node declaring no motion is no body.
pub(super) fn declared_bodies<'a>(
    o: &Options,
    source: (&Value, &[u8]),
    chosen: impl Iterator<Item = &'a usize>,
    world: &[Mat4],
) -> Result<(Vec<Value>, Vec<Value>)> {
    let (g, nodes) = (source.0, values(source.0, "nodes")?);
    let (mut bodies, mut refusals) = (Vec::new(), Vec::new());
    for &node in chosen {
        let Some(declared) = nodes[node].pointer("/extensions/KHR_physics_rigid_bodies") else {
            continue;
        };
        let Some(motion) = declared.get("motion") else {
            continue;
        };
        let body = trs(&world[node])
            .ok_or_else(|| refused("A body's node shears or has no scale.".into()))
            .and_then(|pose| Ok((pose, body_shape(o, source, node, declared)?)));
        match body {
            Ok((pose, shape)) => {
                let mut entry = declared_matter(g, &nodes[node]);
                entry["node"] = json!(node);
                entry["motion"] = motion.clone();
                entry["shape"] = shape;
                place(&mut entry, pose);
                bodies.push(entry);
            }
            Err(e) if e.code == PHYSICS_COOK_FAILED => {
                refusals.push(json!({"node":node,"reason":e.message}))
            }
            Err(e) => return Err(e),
        }
    }
    Ok((bodies, refusals))
}
