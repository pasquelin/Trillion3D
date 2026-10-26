//! The node graph of the prepared scene: every node of the published document at its own rank,
//! with its children, what it carries and its LOCAL pose exactly as the document declares it — a
//! matrix, or any of translation, rotation and scale. The runtime composes world poses from these
//! the way it always has, so a pose read here is the same bits as a pose read from the document.
use super::*;

/// A field copied as the document writes it, `null` when it is absent: the reader tells a declared
/// identity from a missing one the way the host does.
fn declared(owner: &Value, field: &str) -> Value {
    owner.get(field).cloned().unwrap_or(Value::Null)
}

/// The scene the host opens — the one `scene` names, otherwise the first — and `roots`, the nodes
/// at its top in the node table's ranks: selection reads the same rule (`compiler/source/nodes.rs`), so
/// the table and the compiled geometry agree on what the scene is.
pub(super) fn scene_roots(g: &Value, roots: Vec<usize>) -> Result<Value> {
    let rank = optional_index(g.get("scene"), "scene", 0)?;
    let scene = g
        .pointer(&format!("/scenes/{rank}"))
        .unwrap_or(&Value::Null);
    Ok(json!({"name": name_of(scene), "nodes": roots}))
}

/// The name `owner` — a node, a mesh, a skin, an animation, a texture, an image — declares, empty
/// when it declares none.
pub(super) fn name_of(owner: &Value) -> &str {
    owner.get("name").and_then(Value::as_str).unwrap_or("")
}

/// One entry per node of the document: its name, its children, the mesh, camera and skin it carries,
/// its local pose as declared, whether it declares itself visible (`KHR_node_visibility`), and,
/// for a node that is an instance of an assembly, the error and the LOD ball of the group that
/// replaces each primitive's root of its part (`"rootParents"`, `parents`), left out when it
/// names none.
pub(super) fn node_table(g: &Value, parents: &AssemblyParents) -> Result<Vec<Value>> {
    let nodes = values(g, "nodes")?;
    let meshes = g
        .get("meshes")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let skins = g.get("skins").and_then(Value::as_array).map_or(0, Vec::len);
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
        let skin = match node.get("skin") {
            Some(value) => Some(required_index(Some(value), "node.skin")?),
            None => None,
        };
        if skin.is_some_and(|skin| skin >= skins) {
            return Err(invalid("node.skin index is out of bounds"));
        }
        let camera = match node.get("camera") {
            Some(value) => Some(required_index(Some(value), "node.camera")?),
            None => None,
        };
        if camera.is_some_and(|camera| camera >= cameras) {
            return Err(invalid("node.camera index is out of bounds"));
        }
        let source_rank = u32::try_from(id).map_err(|_| invalid("source node rank exceeds u32"))?;
        let mut entry = json!({
            "name": name_of(node),
            "sourceNode": format!("{source_rank:08x}"),
            "children": crate::compiler::source::nodes::children_of(nodes, id)?,
            "mesh": mesh,
            "camera": camera,
            "skin": skin,
            "weights": declared(node, "weights"),
            "matrix": declared(node, "matrix"),
            "translation": declared(node, "translation"),
            "rotation": declared(node, "rotation"),
            "scale": declared(node, "scale"),
            "visible": !crate::compiler::source::nodes::declared_hidden(node),
        });
        if mesh.is_some() {
            if let Some(roots) = parents.of_node(node) {
                entry["rootParents"] = roots;
            }
        }
        table.push(entry);
    }
    Ok(table)
}

/// Writes, on each of `nodes` that draws a mesh, what its settings say of it that the runtime reads
/// from the node table: the distances it is drawn at (`"drawDistance"`, `DrawDistance`), whether a
/// view's primed depth draws it (`"farField"`), whether it casts far shadows
/// (`"castFarShadow"`) and whether a sun's far-shadow test reaches it (`"farShadowTest"`), each
/// left out when it names none. The settings are those of the node's rank in `g` (`"sourceNode"`), resolved once for each node the core keeps
/// — a node that moved to a cell resolved them for its row (`partition/candidates.rs`).
pub(super) fn name_object_settings(
    nodes: &mut [Value],
    g: &Value,
    objects: &crate::ObjectSettings,
) -> Result<()> {
    for entry in nodes.iter_mut().filter(|entry| !entry["mesh"].is_null()) {
        let source = entry["sourceNode"].as_str();
        let id = source.and_then(|rank| usize::from_str_radix(rank, 16).ok());
        let setting = objects.node(
            g,
            id.ok_or_else(|| invalid("a node names its source rank"))?,
        )?;
        if let Some(distance) = setting.draw_distance {
            entry["drawDistance"] = distance.entry();
        }
        if setting.far_field {
            entry["farField"] = json!(true);
        }
        if setting.cast_far_shadow {
            entry["castFarShadow"] = json!(true);
        }
        if let Some(test) = setting.far_shadow_test {
            entry["farShadowTest"] = json!(test);
        }
    }
    Ok(())
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
