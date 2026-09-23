//! The node graph of the prepared scene: every node of the published document at its own rank,
//! with its children, what it carries and its LOCAL pose exactly as the document declares it — a
//! matrix, or any of translation, rotation and scale. The runtime composes world poses from these
//! the way it always has, so a pose read here is the same bits as a pose read from the document.
use super::*;

const LIGHTS: &str = "KHR_lights_punctual";

/// A field copied as the document writes it, `null` when it is absent: the reader tells a declared
/// identity from a missing one the way the host does.
fn declared(owner: &Value, field: &str) -> Value {
    owner.get(field).cloned().unwrap_or(Value::Null)
}

/// The scene the host opens — the one `scene` names, otherwise the first — and the nodes at its
/// top, in its order: the rule selection already reads (`compiler_nodes.rs`), so the table and the
/// compiled geometry agree on what the scene is.
pub(super) fn scene_roots(g: &Value) -> Result<Value> {
    let roots = crate::compiler_nodes::scene_roots(g, values(g, "nodes")?)?;
    let rank = optional_index(g.get("scene"), "scene", 0)?;
    let scene = g
        .pointer(&format!("/scenes/{rank}"))
        .unwrap_or(&Value::Null);
    Ok(json!({"name": name_of(scene), "nodes": roots}))
}

fn name_of(owner: &Value) -> &str {
    owner.get("name").and_then(Value::as_str).unwrap_or("")
}

/// One entry per node of the document: its name, its children, the mesh, light and camera it carries,
/// and its local pose as declared.
pub(super) fn node_table(g: &Value) -> Result<Vec<Value>> {
    let nodes = values(g, "nodes")?;
    let meshes = g
        .get("meshes")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let lights = light_defs(g).len();
    let cameras = g
        .get("cameras")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let mut table = Vec::with_capacity(nodes.len());
    for (id, node) in nodes.iter().enumerate() {
        let mesh = match node.get("mesh") {
            Some(value) => Some(required_index(Some(value), "node.mesh")?),
            None => None,
        };
        if mesh.is_some_and(|mesh| mesh >= meshes) {
            return Err(invalid("node.mesh index is out of bounds"));
        }
        let light = match node.pointer(&format!("/extensions/{LIGHTS}/light")) {
            Some(value) => Some(required_index(Some(value), "node light")?),
            None => None,
        };
        if light.is_some_and(|light| light >= lights) {
            return Err(invalid("node light index is out of bounds"));
        }
        let camera = match node.get("camera") {
            Some(value) => Some(required_index(Some(value), "node.camera")?),
            None => None,
        };
        if camera.is_some_and(|camera| camera >= cameras) {
            return Err(invalid("node.camera index is out of bounds"));
        }
        table.push(json!({
            "name": name_of(node),
            "children": crate::compiler_nodes::children_of(nodes, id)?,
            "mesh": mesh,
            "light": light,
            "camera": camera,
            "matrix": declared(node, "matrix"),
            "translation": declared(node, "translation"),
            "rotation": declared(node, "rotation"),
            "scale": declared(node, "scale"),
        }));
    }
    Ok(table)
}

fn light_defs(g: &Value) -> &[Value] {
    g.pointer(&format!("/extensions/{LIGHTS}/lights"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// The punctual lights the nodes hang, as `KHR_lights_punctual` declares them: the host builds its
/// own light from these, with the specification's defaults where a field is silent. A light of a
/// kind the specification does not name is refused, as the host would refuse it.
pub(super) fn light_table(g: &Value) -> Result<Vec<Value>> {
    light_defs(g)
        .iter()
        .map(|light| {
            let kind = light.get("type").and_then(Value::as_str).unwrap_or("");
            if !matches!(kind, "directional" | "point" | "spot") {
                return Err(invalid(format!("light type {kind:?} is not punctual")));
            }
            Ok(json!({
                "name": name_of(light),
                "type": kind,
                "color": declared(light, "color"),
                "intensity": declared(light, "intensity"),
                "range": declared(light, "range"),
                "innerConeAngle": light.pointer("/spot/innerConeAngle").cloned().unwrap_or(Value::Null),
                "outerConeAngle": light.pointer("/spot/outerConeAngle").cloned().unwrap_or(Value::Null),
            }))
        })
        .collect()
}

/// The cameras the nodes carry, as the document declares them: the host builds its own camera from
/// these, with the specification's defaults where a field is silent.
pub(super) fn camera_table(g: &Value) -> Result<Vec<Value>> {
    let Some(cameras) = g.get("cameras").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    cameras
        .iter()
        .map(|camera| {
            let kind = camera.get("type").and_then(Value::as_str).unwrap_or("");
            let Some(params) = camera
                .get(kind)
                .filter(|_| matches!(kind, "perspective" | "orthographic"))
            else {
                return Err(invalid(format!(
                    "camera type {kind:?} declares no parameters"
                )));
            };
            let field = |name: &str| params.get(name).cloned().unwrap_or(Value::Null);
            Ok(json!({
                "name": name_of(camera),
                "type": kind,
                "yfov": field("yfov"),
                "aspectRatio": field("aspectRatio"),
                "xmag": field("xmag"),
                "ymag": field("ymag"),
                "znear": field("znear"),
                "zfar": field("zfar"),
            }))
        })
        .collect()
}
