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

/// Each node's children by rank, read from the nodes' `children` (`children_of`), each refused
/// unless it is a node of the document.
pub(super) fn child_lists(nodes: &[Value]) -> Result<Vec<Vec<usize>>> {
    (0..nodes.len())
        .map(|id| crate::compiler::source::nodes::children_of(nodes, id))
        .collect()
}

/// Each node's parent by rank, none for a root, from `children`, each node's children
/// (`child_lists`): a hierarchy is a forest, each node the child of one parent at most.
pub(super) fn parents_of(children: &[Vec<usize>]) -> Vec<Option<usize>> {
    let mut parent = vec![None; children.len()];
    for (id, below) in children.iter().enumerate() {
        for &child in below {
            parent[child] = Some(id);
        }
    }
    parent
}

/// Each node's parent by rank, none for a root, read from the nodes' `children` (`child_lists`,
/// `parents_of`).
pub(super) fn node_parents(nodes: &[Value]) -> Result<Vec<Option<usize>>> {
    Ok(parents_of(&child_lists(nodes)?))
}

/// One entry per node of the document: its name, its children, the mesh, camera and skin it carries,
/// its local pose as declared, and whether it declares itself visible (`KHR_node_visibility`).
pub(super) fn node_table(g: &Value) -> Result<Vec<Value>> {
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
        table.push(json!({
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
        }));
    }
    Ok(table)
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
