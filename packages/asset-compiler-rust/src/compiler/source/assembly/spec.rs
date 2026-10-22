//! The assembly a mesh's `extras.assembly` names (`assembly.rs`): its parts, the meshes that are
//! drawn once per node that names them, and its nodes, a part and a transform each.
//!
//! ```json
//! "extras": { "assembly": {
//!   "parts": [ { "mesh": 4, "materialRemap": [2, null] } ],
//!   "nodes": [ { "part": 0, "translation": [0, 0, 3], "rotation": [0, 0.7071, 0, 0.7071] } ]
//! } }
//! ```
//! A part's `materialRemap` gives, for each primitive of its mesh in order, the glTF material the
//! assembly draws it with (`null` none); a part leaving it out keeps its materials, and a primitive
//! past the end of the list keeps its own. A node's transform is a glTF node's: `matrix`, or
//! `translation`, `rotation` and `scale`, in the assembly mesh's own space.
use crate::compiler::source::node_transform::{local_matrix, Mat4};
use crate::*;

/// The key of a mesh's `extras` that names an assembly.
pub(super) const ASSEMBLY_EXTRA: &str = "assembly";
/// The most nodes an assembly holds: the reference's hierarchy numbers a transform in 16 bits.
const MAX_NODES: usize = 65_535;

/// A mesh the assembly draws, and the material it draws each of its primitives with.
pub(super) struct Part {
    pub mesh: usize,
    pub remap: Option<Vec<Option<usize>>>,
}

/// One instance of a part, placed by `matrix` (glTF's column-major form).
pub(super) struct Node {
    pub part: usize,
    pub matrix: Mat4,
}

/// An assembly: at least one part and one node, else it is none.
pub(super) struct Spec {
    pub parts: Vec<Part>,
    pub nodes: Vec<Node>,
}

pub(super) fn refused(what: &str, why: impl Display) -> CompilerError {
    CompilerError::new("INVALID_ASSEMBLY", format!("{what}: {why}"))
}

/// Whether mesh `mesh` of `g` names an assembly.
pub(super) fn names_assembly(g: &Value, mesh: usize) -> bool {
    let named = g.pointer(&format!("/meshes/{mesh}/extras/{ASSEMBLY_EXTRA}"));
    named.is_some_and(|spec| !spec.is_null())
}

/// The glTF material index `value` names, `null` for none, below `materials`.
fn material(value: &Value, what: &str, materials: usize) -> Result<Option<usize>> {
    if value.is_null() {
        return Ok(None);
    }
    bounded(value, what, materials).map(Some)
}

fn read_part(g: &Value, at: usize, part: &Value, assembly: usize) -> Result<Part> {
    let what = format!("meshes[{assembly}].extras.assembly.parts[{at}]");
    let part = GLTF.known(part, &["mesh", "materialRemap"], &what)?;
    let meshes = values(g, "meshes")?.len();
    let mesh = bounded(
        part.get("mesh")
            .ok_or_else(|| refused(&what, "mesh is required"))?,
        &format!("{what}.mesh"),
        meshes,
    )?;
    if mesh == assembly || names_assembly(g, mesh) {
        let why = "a part cannot be an assembly: assemblies of assemblies are not supported";
        return Err(refused(&what, why));
    }
    let materials = g
        .get("materials")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let remap = match part.get("materialRemap").filter(|v| !v.is_null()) {
        None => None,
        Some(list) => {
            let list = GLTF.array(list, &format!("{what}.materialRemap"))?;
            let mapped = list.iter().enumerate().map(|(i, value)| {
                material(value, &format!("{what}.materialRemap[{i}]"), materials)
            });
            Some(mapped.collect::<Result<Vec<_>>>()?)
        }
    };
    Ok(Part { mesh, remap })
}

fn read_node(at: usize, node: &Value, parts: usize, assembly: usize) -> Result<Node> {
    let what = format!("meshes[{assembly}].extras.assembly.nodes[{at}]");
    let fields = ["part", "translation", "rotation", "scale", "matrix"];
    GLTF.known(node, &fields, &what)?;
    let part = bounded(
        node.get("part")
            .ok_or_else(|| refused(&what, "part is required"))?,
        &format!("{what}.part"),
        parts,
    )?;
    Ok(Node {
        part,
        matrix: local_matrix(node)?,
    })
}

/// The assembly mesh `mesh` names: `None` when it names no part or no node, as the reference
/// builds no assembly then; a refusal naming the field when the data does not read.
pub(super) fn read(g: &Value, mesh: usize) -> Result<Option<Spec>> {
    let what = format!("meshes[{mesh}].extras.{ASSEMBLY_EXTRA}");
    let named = g.pointer(&format!("/meshes/{mesh}/extras/{ASSEMBLY_EXTRA}"));
    let named = named.ok_or_else(|| refused(&what, "it names no assembly"))?;
    let spec = GLTF.known(named, &["parts", "nodes"], &what)?;
    let list = |key: &str| match spec.get(key).filter(|v| !v.is_null()) {
        None => Ok(&[][..]),
        Some(list) => GLTF
            .array(list, &format!("{what}.{key}"))
            .map(Vec::as_slice),
    };
    let (parts, nodes) = (list("parts")?, list("nodes")?);
    if parts.is_empty() || nodes.is_empty() {
        return Ok(None);
    }
    if nodes.len() > MAX_NODES {
        let (count, most) = (nodes.len(), MAX_NODES);
        return Err(refused(
            &what,
            format!("{count} nodes: an assembly holds at most {most}"),
        ));
    }
    let parts = (parts.iter().enumerate())
        .map(|(at, part)| read_part(g, at, part, mesh))
        .collect::<Result<Vec<_>>>()?;
    let nodes = (nodes.iter().enumerate())
        .map(|(at, node)| read_node(at, node, parts.len(), mesh))
        .collect::<Result<Vec<_>>>()?;
    Ok(Some(Spec { parts, nodes }))
}
