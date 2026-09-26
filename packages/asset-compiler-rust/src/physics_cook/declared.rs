//! What a source declares for a node through `KHR_physics_rigid_bodies` and `KHR_implicit_shapes`.
//! Nothing is guessed: the friction and restitution of the `physicsMaterial` its collider names,
//! when it names one (a node that names none carries none, and the runtime gives its tiles the
//! engine's default matter); and, for a node declaring motion, the body it is: its motion and
//! implicit shape as declared, else the hulls of a mesh (`hulls.rs`), weighed here, at cook time.
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

/// The `physics.json` entry of the body node `index` (`node`) declares with `declared`, placed by
/// `matrix`: its `motion` as declared, its matter, pose and shape — the `KHR_implicit_shapes` shape
/// its collider names, as declared; else the cooked hulls of the mesh its collider names (its own
/// without a collider), one hull when the collider asks for its convex hull.
fn body(
    o: &Options,
    (g, bin): (&Value, &[u8]),
    (index, node): (usize, &Value),
    declared: &Value,
    matrix: &Mat4,
) -> Result<Value> {
    let pose =
        trs(matrix).ok_or_else(|| refused("A body's node shears or has no scale.".into()))?;
    let field = |key: &str| {
        declared
            .pointer("/collider/geometry")
            .and_then(|g| g.get(key))
    };
    let shape = match field("shape").and_then(Value::as_u64) {
        Some(id) => g
            .pointer(&format!("/extensions/KHR_implicit_shapes/shapes/{id}"))
            .cloned()
            .ok_or_else(|| {
                refused(format!(
                    "A body's collider names shape {id}, which is missing."
                ))
            })?,
        None => {
            let at = field("node")
                .and_then(Value::as_u64)
                .map_or(index, |n| n as usize);
            let mesh = values(g, "nodes")?.get(at).and_then(|n| n.get("mesh"));
            let mesh = mesh.ok_or_else(|| {
                refused(format!(
                    "A body's collider names node {at}, which draws no mesh."
                ))
            })?;
            let hull = field("convexHull") == Some(&Value::Bool(true));
            cooked_hulls(o, (g, bin), required_index(Some(mesh), "node.mesh")?, hull)?
        }
    };
    let mut entry = declared_matter(g, node);
    entry["node"] = json!(index);
    entry["motion"] = declared["motion"].clone();
    entry["shape"] = shape;
    place(&mut entry, pose);
    Ok(entry)
}

/// The rigid bodies the nodes `chosen` declare, placed by their `world` matrices: their
/// `physics.json` entries, and the report's refusals (`node`, `reason`). A node declaring no
/// motion is no body.
pub(super) fn declared_bodies<'a>(
    o: &Options,
    source: (&Value, &[u8]),
    chosen: impl Iterator<Item = &'a usize>,
    world: &[Mat4],
) -> Result<(Vec<Value>, Vec<Value>)> {
    let nodes = values(source.0, "nodes")?;
    let (mut bodies, mut refusals) = (Vec::new(), Vec::new());
    for &index in chosen {
        let declared = &nodes[index]["extensions"]["KHR_physics_rigid_bodies"];
        if declared.get("motion").is_none() {
            continue;
        }
        match body(o, source, (index, &nodes[index]), declared, &world[index]) {
            Ok(entry) => bodies.push(entry),
            Err(e) if e.code == PHYSICS_COOK_FAILED => {
                refusals.push(json!({"node":index,"reason":e.message}))
            }
            Err(e) => return Err(e),
        }
    }
    Ok((bodies, refusals))
}
