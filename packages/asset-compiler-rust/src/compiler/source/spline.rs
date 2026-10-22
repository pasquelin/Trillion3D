//! Spline meshes: a node whose `extras.splineMesh` names a curve is drawn bent along it. The mesh
//! of the node is bent once, here, before anything reads it: each vertex goes where the curve's
//! slice at its distance puts it, its normal and tangent turn with the slice (`bend.rs`), and the
//! node takes the bent copy; the cluster DAG, the pages, the proxy and the collider are then built
//! of the bent mesh, so every error they hold is measured on the shape that is drawn. Each node
//! that names a spline gets a mesh of its own: a rail of five hundred segments is five hundred
//! meshes, their pages and their builds, where the reference keeps one and bends it as it draws;
//! the source mesh they share is decoded once (`arrays.rs`), kept until the last of them bent it.
//!
//! `extras.splineMesh` holds, each left out at the default of the reference's spline mesh
//! component (lengths in metres, its centimetres over a hundred):
//! - `startPos` [0, 0, 0], `startTangent` [1, 0, 0], `endPos` [1, 0, 0], `endTangent` [1, 0, 0]: the
//!   curve, in the node's own space;
//! - `startScale` and `endScale` [1, 1]: the scale across the curve at each end, on the mesh's two
//!   axes other than the forward one; `startRoll` and `endRoll` 0: the roll about the curve, in
//!   radians; `startOffset` and `endOffset` [0, 0]: the mesh's offset from the curve across it;
//! - `splineUpDir` [0, 0, 1]: the direction the curve's frame leans on, held within [-1, 1];
//! - `smoothInterpRollScale` false: whether scale, roll and offset ease in and out along the curve
//!   instead of changing at a constant pace;
//! - `forwardAxis` `x`: the mesh's axis laid along the curve, `x`, `y` or `z`; `boundaryMin` and
//!   `boundaryMax` 0: the range on that axis that maps to the curve, the mesh's own extent when
//!   they are equal.
//! A mesh the curve mirrors (its start scales differ in sign) has its triangles turned over and its
//! tangents' sign reversed. A node whose mesh is skinned or morphed cannot be bent, nor one whose
//! mesh names an assembly the job builds (`allowAssemblies`, read later with the job's settings:
//! `refuse_bent_assembly`); an assembly not built is its own triangles, bent as any mesh.
use crate::compiler::primitive::triangles;
use crate::compiler::source::load::compressed::Budget;
use crate::compiler::source::nodes::moves_by_itself;
use crate::compiler::source::synth::seal;
use crate::*;
use arrays::{bent_copy, Decoded};
use bend::Bend;
use read::{read_bend, SPLINE};

mod arrays;
mod bend;
mod read;
#[cfg(test)]
mod tests;

/// The key of a node's `extras` that names a spline mesh.
const SPLINE_EXTRA: &str = "splineMesh";

/// The nodes that name a spline and place a mesh: the node, its mesh and the bend. A node that
/// places no mesh bends nothing.
fn marked_nodes(g: &Value) -> Result<Vec<(usize, usize, Bend)>> {
    let Some(nodes) = g.get("nodes").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let meshes = g.get("meshes").and_then(Value::as_array);
    let meshes = meshes.map_or(&[][..], Vec::as_slice);
    let mut marked = Vec::new();
    for (id, node) in nodes.iter().enumerate() {
        let named = node
            .get("extras")
            .and_then(|extras| extras.get(SPLINE_EXTRA));
        let (Some(spec), Some(mesh)) = (named.filter(|spec| !spec.is_null()), node.get("mesh"))
        else {
            continue;
        };
        let what = format!("nodes[{id}].extras.{SPLINE_EXTRA}");
        if moves_by_itself(node) {
            return Err(SPLINE.bad(format!("{what}: a skinned or morphed mesh cannot be bent")));
        }
        let mesh = bounded(mesh, "node.mesh", meshes.len())?;
        marked.push((id, mesh, read_bend(spec, &what)?));
    }
    Ok(marked)
}

/// The count accessor `id` declares, 0 for an absent or unreadable one.
fn declared(g: &Value, id: Option<&Value>) -> usize {
    let at = id
        .and_then(Value::as_u64)
        .and_then(|id| usize::try_from(id).ok());
    let accessor = at.and_then(|at| g.get("accessors")?.get(at));
    let count = accessor.and_then(|a| a.get("count")?.as_u64());
    count.and_then(|n| usize::try_from(n).ok()).unwrap_or(0)
}

/// The triangle primitives of mesh `mesh`, each with the counts its accessors declare: its
/// vertices, its normals, its tangents and its corners.
fn triangle_counts(g: &Value, mesh: usize) -> Vec<[usize; 4]> {
    let primitives = g.get("meshes").and_then(|meshes| meshes.get(mesh));
    let primitives = primitives.and_then(|m| m.get("primitives")?.as_array());
    let triangles = primitives
        .into_iter()
        .flatten()
        .filter(|p| triangles::is_triangle_list(p));
    triangles
        .map(|p| {
            let of =
                |semantic: &str| declared(g, p.get("attributes").and_then(|a| a.get(semantic)));
            let vertices = of("POSITION");
            let corners = declared(g, p.get("indices")).max(vertices);
            [vertices, of("NORMAL"), of("TANGENT"), corners]
        })
        .collect()
}

/// About how many bytes bending `mesh` appends to the binary: the arrays of each triangle primitive
/// it bends, from the counts its accessors declare, each array four-aligned.
fn bent_bytes(g: &Value, mesh: usize, bend: &Bend) -> usize {
    let mut bytes = 0usize;
    for [vertices, normals, tangents, corners] in triangle_counts(g, mesh) {
        let turned = if bend.mirrors() { corners } else { 0 };
        bytes += 12 * vertices + 12 * normals + 16 * tangents + 4 * turned + 16;
    }
    bytes
}

/// About how many bytes the decoded arrays of `mesh` hold (`Decoded`): its positions, normals,
/// tangents and corners.
fn decoded_bytes(g: &Value, mesh: usize) -> usize {
    (triangle_counts(g, mesh).into_iter())
        .map(|[vertices, normals, tangents, corners]| {
            12 * vertices + 12 * normals + 16 * tangents + 4 * corners
        })
        .fold(0, usize::saturating_add)
}

/// The refusal of the bent copy `mesh` that names an assembly the job builds: the curve would bend
/// the assembly's own triangles and not its parts.
pub(crate) fn refuse_bent_assembly(mesh: usize) -> CompilerError {
    SPLINE.bad(format!(
        "meshes[{mesh}]: a mesh that names an assembly cannot be bent"
    ))
}

/// Bends every mesh a node names a spline for, the node taking the bent copy; returns the binary
/// with the bent arrays appended, within `budget`, and the bent copies. A document naming no spline
/// is returned as it came, a mapped binary still mapped.
pub(crate) fn bend_spline_meshes(
    g: &mut Value,
    binary: Binary,
    budget: &Budget<'_>,
) -> Result<(Binary, Vec<usize>)> {
    let marked = marked_nodes(g)?;
    if marked.is_empty() {
        return Ok((binary, Vec::new()));
    }
    // A mesh several nodes bend is decoded once, kept until the last of them has bent it.
    let mut remaining: BTreeMap<usize, usize> = BTreeMap::new();
    for (_, mesh, _) in &marked {
        *remaining.entry(*mesh).or_default() += 1;
    }
    let extra: usize = (marked.iter())
        .map(|(_, mesh, bend)| bent_bytes(g, *mesh, bend))
        .fold(0, usize::saturating_add);
    let kept: usize = (remaining.iter())
        .filter(|(_, nodes)| **nodes > 1)
        .map(|(mesh, _)| decoded_bytes(g, *mesh))
        .fold(0, usize::saturating_add);
    let held = binary.bytes().len().saturating_add(extra);
    budget.admit(held.saturating_add(kept))?;
    let mut out = binary.into_owned(extra)?;
    let mut bent_meshes = Vec::with_capacity(marked.len());
    let mut cache: BTreeMap<usize, Decoded> = BTreeMap::new();
    for (node, mesh, bend) in marked {
        let bent =
            bent_copy(g, &mut out, (mesh, &mut cache, &mut remaining), &bend).map_err(|e| {
                let what = format!("nodes[{node}].extras.{SPLINE_EXTRA}");
                CompilerError::new(e.code, format!("{what}: {}", e.message))
            })?;
        let meshes = g["meshes"]
            .as_array_mut()
            .ok_or_else(|| invalid("meshes array is required"))?;
        meshes.push(bent);
        let placed = meshes.len() - 1;
        bent_meshes.push(placed);
        g["nodes"][node]["mesh"] = json!(placed);
        if let Some(extras) = g["nodes"][node]["extras"].as_object_mut() {
            extras.remove(SPLINE_EXTRA);
        }
    }
    seal(g, &out);
    Ok((Binary::Owned(out), bent_meshes))
}
