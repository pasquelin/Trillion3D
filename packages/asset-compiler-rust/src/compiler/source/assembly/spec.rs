//! The assembly a mesh's `extras.assembly` names (`assembly.rs`): its parts, the meshes that are
//! drawn once for each node that names them, and its nodes, a part and a transform each.
//!
//! ```json
//! "extras": { "assembly": {
//!   "parts": [ { "mesh": 4, "materialRemap": [2, null] } ],
//!   "nodes": [ { "part": 0, "translation": [0, 0, 3], "rotation": [0, 0.7071, 0, 0.7071] } ]
//! } }
//! ```
//! A part's `materialRemap` gives, for each primitive of its mesh in order, the glTF material the
//! assembly draws it with (`null` none); a primitive past the end of the list takes the assembly's
//! first slot, and a part leaving the list out takes the assembly's slot of each primitive's rank —
//! a slot being the material of the assembly mesh's primitive of that rank. A part also takes the
//! assembly mesh's shape, tangents, texture hold, edge bound and voxel settings. A node's transform
//! is a glTF node's: `matrix`, or
//! `translation`, `rotation` and `scale`, in the assembly mesh's own space.
use crate::compiler::primitive::triangles;
use crate::compiler::source::node_transform::local_matrix;
use crate::*;
use serde_json::Map;

/// The readers of an assembly's data: every refusal of it is `INVALID_ASSEMBLY`.
pub(super) const ASSEMBLY: Fields = Fields("INVALID_ASSEMBLY");
/// The key of a mesh's `extras` that names an assembly.
const ASSEMBLY_EXTRA: &str = "assembly";
/// The most nodes an assembly holds: the reference's hierarchy numbers a transform in 16 bits.
const MAX_NODES: usize = 65_535;

/// A mesh the assembly draws, and the material it draws each of its primitives with.
pub(super) struct Part {
    pub mesh: usize,
    pub remap: Option<Vec<Option<usize>>>,
}

/// One instance of a part: the fields of a glTF node's transform that name where it stands.
pub(super) struct Node {
    pub part: usize,
    pub transform: Map<String, Value>,
}

/// An assembly: at least one part and one node.
pub(super) struct Spec {
    pub parts: Vec<Part>,
    pub nodes: Vec<Node>,
}

/// The assembly `mesh` names, if it names one: its `extras.assembly` is an object.
pub(super) fn extra_of(mesh: &Value) -> Option<&Value> {
    let named = mesh
        .get("extras")
        .and_then(|extras| extras.get(ASSEMBLY_EXTRA));
    named.filter(|value| value.is_object())
}

/// Whether `mesh`, a glTF mesh, names an assembly.
pub(crate) fn names_assembly(mesh: &Value) -> bool {
    extra_of(mesh).is_some()
}

/// The index `value` names below `len`.
fn within(value: &Value, what: &str, len: usize) -> Result<usize> {
    let index = ASSEMBLY.index(Some(value), what)?;
    match index < len {
        true => Ok(index),
        false => Err(ASSEMBLY.bad(format!("{what} index {index} is out of bounds"))),
    }
}

/// The glTF material index `value` names, `null` for none, below `materials`.
fn material(value: &Value, what: &str, materials: usize) -> Result<Option<usize>> {
    match value.is_null() {
        true => Ok(None),
        false => within(value, what, materials).map(Some),
    }
}

/// Part `at` of assembly `assembly`, read from `part`: refused when a node places it (`placed`) and
/// it is an assembly that is built (`allowed`: a part is built whole, never as an assembly of its
/// own) — a part no node places is not laid out, so the reference never meets its nesting —, or
/// when it moves with bones or morph targets.
fn read_part(
    g: &Value,
    (at, part, placed): (usize, &Value, bool),
    (assembly, allowed): (usize, &[usize]),
) -> Result<Part> {
    let what = format!("meshes[{assembly}].extras.assembly.parts[{at}]");
    let part = ASSEMBLY.known(part, &["mesh", "materialRemap"], &what)?;
    let meshes = values(g, "meshes")?;
    let named = part
        .get("mesh")
        .ok_or_else(|| ASSEMBLY.bad(format!("{what}.mesh is required")))?;
    let mesh = within(named, &format!("{what}.mesh"), meshes.len())?;
    if placed && (mesh == assembly || allowed.contains(&mesh)) {
        let why = "a part cannot be an assembly: assemblies of assemblies are not supported";
        return Err(ASSEMBLY.bad(format!("{what}: {why}")));
    }
    let primitives = meshes[mesh].get("primitives").and_then(Value::as_array);
    if !primitives.into_iter().flatten().all(triangles::is_rigid) {
        let why = "an assembly is static: a part has no bones and no morph targets";
        return Err(ASSEMBLY.bad(format!("{what}: {why}")));
    }
    let materials = g
        .get("materials")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let remap = match part.get("materialRemap").filter(|v| !v.is_null()) {
        None => None,
        Some(list) => {
            let list = ASSEMBLY.array(list, &format!("{what}.materialRemap"))?;
            let mapped = (list.iter().enumerate()).map(|(i, value)| {
                material(value, &format!("{what}.materialRemap[{i}]"), materials)
            });
            Some(mapped.collect::<Result<Vec<_>>>()?)
        }
    };
    Ok(Part { mesh, remap })
}

/// Node `at` of assembly `assembly`, read from `node`: a part below `parts` and a glTF transform.
fn read_node(at: usize, node: &Value, (parts, assembly): (usize, usize)) -> Result<Node> {
    let what = format!("meshes[{assembly}].extras.assembly.nodes[{at}]");
    let fields = ["part", "translation", "rotation", "scale", "matrix"];
    let node = ASSEMBLY.known(node, &fields, &what)?;
    let named = node
        .get("part")
        .ok_or_else(|| ASSEMBLY.bad(format!("{what}.part is required")))?;
    let part = within(named, &format!("{what}.part"), parts)?;
    let transform: Map<String, Value> = (node.iter())
        .filter(|(key, _)| key.as_str() != "part")
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    // Read as a glTF node's transform, so that a refusal and a matrix are the document's own.
    local_matrix(&Value::Object(transform.clone()))
        .map_err(|e| ASSEMBLY.bad(format!("{what}: {}", e.message)))?;
    Ok(Node { part, transform })
}

/// The assembly mesh `mesh` names, read whole before any assembly is laid out: `None` when it
/// names no part or no node, as the reference builds no assembly then; a refusal naming the field
/// when the data does not read. `allowed` are the meshes whose assembly is built: none is a part.
pub(super) fn read(g: &Value, mesh: usize, allowed: &[usize]) -> Result<Option<Spec>> {
    let what = format!("meshes[{mesh}].extras.{ASSEMBLY_EXTRA}");
    let extra = extra_of(&g["meshes"][mesh]);
    let extra = extra.ok_or_else(|| ASSEMBLY.bad(format!("{what} is not an assembly")))?;
    let spec = ASSEMBLY.known(extra, &["parts", "nodes"], &what)?;
    let list = |key: &str| match spec.get(key).filter(|v| !v.is_null()) {
        None => Ok(&[][..]),
        Some(list) => ASSEMBLY
            .array(list, &format!("{what}.{key}"))
            .map(Vec::as_slice),
    };
    let (parts, nodes) = (list("parts")?, list("nodes")?);
    if parts.is_empty() || nodes.is_empty() {
        return Ok(None);
    }
    if nodes.len() > MAX_NODES {
        let (count, most) = (nodes.len(), MAX_NODES);
        return Err(ASSEMBLY.bad(format!(
            "{what}: {count} nodes: an assembly holds at most {most}"
        )));
    }
    let nodes = (nodes.iter().enumerate())
        .map(|(at, node)| read_node(at, node, (parts.len(), mesh)))
        .collect::<Result<Vec<_>>>()?;
    let mut placed = vec![false; parts.len()];
    for node in &nodes {
        placed[node.part] = true;
    }
    let parts = (parts.iter().zip(placed).enumerate())
        .map(|(at, (part, placed))| read_part(g, (at, part, placed), (mesh, allowed)))
        .collect::<Result<Vec<_>>>()?;
    Ok(Some(Spec { parts, nodes }))
}
