//! What a source declares for a node through `KHR_physics_rigid_bodies` and `KHR_implicit_shapes`.
//! Nothing is guessed: the friction and restitution of the `physicsMaterial` its collider names,
//! when it names one (a node that names none carries none, and the runtime gives its tiles the
//! engine's default matter); and, for a node declaring motion, the body it is: its motion and
//! implicit shape as declared, else the hulls of a mesh (`hulls.rs`), weighed here, at cook time.
use super::hulls::cooked_hulls;
use super::stage::{place, trs};
use super::{refused, PHYSICS_COOK_FAILED};
use crate::compiler_nodes::scene_nodes;
use crate::compiler_validate::values;
use crate::compiler_world::{multiply, rotation_matrix, scaling, translation, Mat4};
use crate::{Options, Result};
use serde_json::{json, Value};
use std::collections::BTreeSet;

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

/// The `physics.json` entry of the body node `index` of `nodes` declares, placed by its `world`
/// matrix: its `motion` as declared, its matter, pose and shape — the `KHR_implicit_shapes` shape
/// its collider names, as declared; else the cooked hulls of the mesh its collider names (its own
/// without a collider), moved into the body's frame, one hull when the collider asks for its
/// convex hull.
fn body(
    o: &Options,
    source: (&Value, &[u8]),
    nodes: &[Value],
    index: usize,
    world: &[Mat4],
) -> Result<Value> {
    let declared = &nodes[index]["extensions"]["KHR_physics_rigid_bodies"];
    let pose = trs(&world[index])
        .ok_or_else(|| refused("A body's node shears or has no scale.".into()))?;
    let field = |key: &str| declared.pointer(&format!("/collider/geometry/{key}"));
    let shape = match field("shape").and_then(Value::as_u64) {
        Some(id) => (source.0)
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
            let mesh = nodes.get(at).and_then(|n| n["mesh"].as_u64());
            let mesh = mesh.ok_or_else(|| {
                refused(format!(
                    "A body's collider names node {at}, which draws no mesh."
                ))
            })?;
            // Another node's mesh is moved by its placement relative to the body's (`trs`).
            let (t, [x, y, z, w], s) = pose;
            let undo = multiply(
                &rotation_matrix([-x, -y, -z, w]),
                &translation(t.map(|v| -v)),
            );
            let frame = (at != index)
                .then(|| multiply(&scaling(s.map(|v| 1.0 / v)), &multiply(&undo, &world[at])));
            let one_hull = field("convexHull") == Some(&Value::Bool(true));
            cooked_hulls(o, source, (mesh as usize, frame), one_hull)?
        }
    };
    let mut entry = declared_matter(source.0, &nodes[index]);
    entry["node"] = json!(index);
    entry["motion"] = declared["motion"].clone();
    entry["shape"] = shape;
    place(&mut entry, pose);
    Ok(entry)
}

/// The rigid bodies the rendered scene's nodes but `soft` declare, placed by their `world` matrices: their
/// `physics.json` entries, and the report's refusals (`node`, `reason`). A node declaring no
/// motion is no body; one that draws nothing is a body all the same.
pub(super) fn declared_bodies(
    o: &Options,
    source: (&Value, &[u8]),
    soft: &BTreeSet<usize>,
    world: &[Mat4],
) -> Result<(Vec<Value>, Vec<Value>)> {
    let nodes = values(source.0, "nodes")?;
    let (mut bodies, mut refusals) = (Vec::new(), Vec::new());
    let moving = |i: &&usize| nodes[**i].pointer("/extensions/KHR_physics_rigid_bodies/motion");
    for &index in scene_nodes(source.0)?
        .difference(soft)
        .filter(|i| moving(i).is_some())
    {
        match body(o, source, nodes, index, world) {
            Ok(entry) => bodies.push(entry),
            Err(e) if e.code == PHYSICS_COOK_FAILED => {
                refusals.push(json!({"node":index,"reason":e.message}))
            }
            Err(e) => return Err(e),
        }
    }
    Ok((bodies, refusals))
}
