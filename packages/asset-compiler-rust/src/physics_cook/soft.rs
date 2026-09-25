//! Soft bodies a compiled model declares: a node whose `extras.physics` holds the options
//! `obj.physics` takes for a cloth, a rope or a volume (`type`, `pins`, `mass`, `stretch`, `bend`,
//! `pressure`; its matter, pull and damping the page reads as it reads `obj.physics`). The vertices
//! of the node's one primitive become the simulated ones (`soft_record.rs`) at the node's world
//! scale, and native Jolt builds their `SoftBodySharedSettings` with the physics worker's own
//! builder, stored under the SHA-256 of their bytes like a tile: the page restores them, nothing is
//! built there. Such a node is no static ground; one the cook refuses is named in the report.
use super::cut::store_shape;
use super::declared::declared_matter;
use super::soft_record::{soft_record, SoftDeclared};
use super::stage::trs;
use super::{soft_settings, PHYSICS_COOK_FAILED};
use crate::compiler_accessor_create::accessor;
use crate::compiler_validate::{item, required_index, values};
use crate::compiler_world::Mat4;
use crate::{CompilerError, Options, Result};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const KINDS: [&str; 3] = ["cloth", "rope", "volume"];

/// The kind of soft body a node declares and its options; `None` when it declares a rigid body or
/// nothing, and is then static ground.
pub(super) fn declared_soft(node: &Value) -> Option<(&'static str, &Value)> {
    let option = node.pointer("/extras/physics")?;
    let kind = option.get("type").and_then(Value::as_str)?;
    Some((KINDS.into_iter().find(|k| *k == kind)?, option))
}

/// The options of a `kind` once read, each number 0 and up (`softSettings`); the page's words
/// otherwise.
fn read(kind: &'static str, option: &Value) -> std::result::Result<SoftDeclared, String> {
    for name in ["shape", "sensor", "ccd", "decorative"] {
        if option.get(name).is_some() {
            return Err(format!("A soft body takes no {name}."));
        }
    }
    if option.pointer("/damping/angular").is_some() {
        return Err("A soft body takes no angular damping: its vertices do not turn.".into());
    }
    let number = |name: &str| match option.get(name) {
        None => Ok(None),
        Some(value) => match value.as_f64() {
            Some(v) if v >= 0.0 => Ok(Some(v)),
            _ => Err(format!("A soft body's {name} is 0 and up: {value}.")),
        },
    };
    let pins = match option.get("pins") {
        None => Vec::new(),
        Some(pins) => pins
            .as_array()
            .and_then(|pins| pins.iter().map(Value::as_f64).collect())
            .ok_or_else(|| format!("A soft body's pins are vertex indices: {pins}."))?,
    };
    Ok(SoftDeclared {
        kind,
        pins,
        mass: number("mass")?,
        stretch: number("stretch")?.unwrap_or(0.0),
        bend: number("bend")?.unwrap_or(f64::INFINITY),
        // As on the page, a cloth's or a rope's pressure is not read: it holds no gas.
        pressure: if kind == "volume" {
            number("pressure")?
        } else {
            None
        },
    })
}

/// The `physics.json` entry of the soft body `kind` and `option` declare on `node`, placed by
/// `matrix`.
fn soft_body(
    o: &Options,
    (g, bin): (&Value, &[u8]),
    node: &Value,
    matrix: &Mat4,
    (kind, option): (&'static str, &Value),
) -> Result<Value> {
    let refuse = |message: String| CompilerError::new(PHYSICS_COOK_FAILED, message);
    let declared = read(kind, option).map_err(refuse)?;
    let mesh = item(
        values(g, "meshes")?,
        required_index(node.get("mesh"), "node.mesh")?,
        "mesh",
    )?;
    let primitives = values(mesh, "primitives")?;
    if primitives.len() != 1 {
        let count = primitives.len();
        return Err(refuse(format!(
            "A soft body is one primitive: its mesh holds {count}."
        )));
    }
    let primitive = &primitives[0];
    let position = required_index(primitive.pointer("/attributes/POSITION"), "POSITION")?;
    let pos = accessor(g, bin, position, None)?.collect_f32()?;
    let corners = primitive
        .get("indices")
        .map(|id| accessor(g, bin, required_index(Some(id), "indices")?, None)?.collect_u32())
        .transpose()?;
    let (t, q, s) = trs(matrix).ok_or_else(|| refuse("A soft body's node shears.".into()))?;
    let record = soft_record(&pos, corners.as_deref(), s, &declared).map_err(refuse)?;
    let (stretch, bend) = (declared.stretch as f32, declared.bend as f32);
    let scale = s.map(|v| v as f32);
    let bytes = soft_settings(&record.vertices, scale, &record.indices, stretch, bend)?;
    let mut entry = declared_matter(g, node);
    entry["physics"] = option.clone();
    entry["settings"] = store_shape(o, &bytes)?;
    entry["vertices"] = json!(record.vertices.len() / 4);
    entry["pressure"] = json!(record.pressure);
    entry["position"] = json!(t);
    entry["rotation"] = json!(q);
    entry["scale"] = json!(s);
    Ok(entry)
}

/// The soft bodies the drawn nodes `chosen` declare, placed by their `world` matrices: their
/// `physics.json` entries and the report's refusals (`node`, `reason`).
pub(super) fn soft_bodies(
    o: &Options,
    source: (&Value, &[u8]),
    chosen: &BTreeSet<usize>,
    world: &[Mat4],
) -> Result<(Vec<Value>, Vec<Value>)> {
    let nodes = values(source.0, "nodes")?;
    let (mut bodies, mut refused) = (Vec::new(), Vec::new());
    for &node in chosen {
        let Some(declared) = declared_soft(&nodes[node]) else {
            continue;
        };
        match soft_body(o, source, &nodes[node], &world[node], declared) {
            Ok(mut entry) => {
                entry["node"] = json!(node);
                bodies.push(entry);
            }
            Err(e) if e.code == PHYSICS_COOK_FAILED => {
                refused.push(json!({"node":node,"reason":e.message}));
            }
            Err(e) => return Err(e),
        }
    }
    Ok((bodies, refused))
}
