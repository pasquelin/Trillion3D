//! Spline meshes: a node whose `extras.splineMesh` names a curve is drawn bent along it. The mesh
//! of the node is bent once, here, before anything reads it: each vertex goes where the curve's
//! slice at its distance puts it, its normal and tangent turn with the slice (`bend.rs`), and the
//! node takes the bent copy; the cluster DAG, the pages, the proxy and the collider are then built
//! of the bent mesh, so every error they hold is measured on the shape that is drawn. Each node
//! that names a spline gets a mesh of its own: a rail of five hundred segments is five hundred
//! meshes, their pages and their builds, where the reference keeps one and bends it as it draws.
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
use crate::compiler::source::synth::{
    attribute, float_accessor, index_accessor, position_accessor, seal,
};
use crate::*;
use bend::{Bend, Fit};
use read::{read_bend, SPLINE};
use trillion3d_math::geometry::aabb::aabb_of_f32;
use trillion3d_math::vector::vec3::point_f32;

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

/// About how many bytes bending `mesh` appends to the binary: the arrays of each triangle primitive
/// it bends, from the counts its accessors declare, each array four-aligned.
fn bent_bytes(g: &Value, mesh: usize, bend: &Bend) -> usize {
    let count = |id: Option<&Value>| -> usize {
        let at = id
            .and_then(Value::as_u64)
            .and_then(|id| usize::try_from(id).ok());
        let accessor = at.and_then(|at| g.get("accessors")?.get(at));
        let count = accessor.and_then(|a| a.get("count")?.as_u64());
        count.and_then(|n| usize::try_from(n).ok()).unwrap_or(0)
    };
    let primitives = g.get("meshes").and_then(|meshes| meshes.get(mesh));
    let primitives = primitives.and_then(|m| m.get("primitives")?.as_array());
    let mut bytes = 0usize;
    for p in primitives.into_iter().flatten() {
        if !triangles::is_triangle_list(p) {
            continue;
        }
        let of = |semantic: &str| count(p.get("attributes").and_then(|a| a.get(semantic)));
        let vertices = of("POSITION");
        let corners = if bend.mirrors() {
            count(p.get("indices")).max(vertices)
        } else {
            0
        };
        bytes += 12 * vertices + 12 * of("NORMAL") + 16 * of("TANGENT") + 4 * corners + 16;
    }
    bytes
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
    let extra: usize = (marked.iter())
        .map(|(_, mesh, bend)| bent_bytes(g, *mesh, bend))
        .fold(0, usize::saturating_add);
    budget.admit(binary.bytes().len().saturating_add(extra))?;
    let mut out = binary.into_owned(extra)?;
    let mut bent_meshes = Vec::with_capacity(marked.len());
    for (node, mesh, bend) in marked {
        let bent = bend_mesh(g, &mut out, mesh, &bend).map_err(|e| {
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

/// One triangle primitive's arrays, as the bend reads them: its positions, its triangles' corners
/// and the normals and tangents it carries.
struct Arrays {
    positions: Vec<f32>,
    indices: Vec<u32>,
    normals: Option<Vec<f32>>,
    tangents: Option<Vec<f32>>,
}

impl Arrays {
    /// The arrays of triangle primitive `p`; refused when it has bones or morph targets.
    fn read(g: &Value, bin: &[u8], p: &Value) -> Result<Self> {
        if !triangles::is_rigid(p) {
            return Err(SPLINE.bad("a skinned or morphed mesh cannot be bent"));
        }
        let (positions, indices, _) = triangles::read(g, bin, p, None)?;
        let positions = positions.collect_f32()?;
        let count = positions.len() / 3;
        Ok(Self {
            normals: attribute(g, bin, p, ("NORMAL", 3), count)?,
            tangents: attribute(g, bin, p, ("TANGENT", 4), count)?,
            positions,
            indices,
        })
    }

    /// Every vertex bent by `bend` under `fit`: its position, and the normal and tangent it may
    /// carry, and, when the bend mirrors the mesh, its triangles turned over and the tangents' sign
    /// — the frame's handedness — reversed. A vertex the bend sends to a point that is not a
    /// number is refused.
    fn bend(&self, (bend, fit): (&Bend, Fit)) -> Result<Self> {
        let count = self.positions.len() / 3;
        let mirror = if bend.mirrors() { -1.0 } else { 1.0 };
        let turned_over = |triangle: &[u32]| [triangle[0], triangle[2], triangle[1]];
        let mut done = Self {
            positions: Vec::with_capacity(self.positions.len()),
            indices: match bend.mirrors() {
                true => self.indices.chunks_exact(3).flat_map(turned_over).collect(),
                false => Vec::new(),
            },
            normals: self.normals.as_ref().map(|_| Vec::with_capacity(count * 3)),
            tangents: self
                .tangents
                .as_ref()
                .map(|_| Vec::with_capacity(count * 4)),
        };
        let tangents = self.tangents.as_deref().map(|t| t.as_chunks::<4>().0);
        for v in 0..count {
            let carried = tangents.map(|t| t[v]);
            let normal = self.normals.as_deref().map(|n| point_f32(n, v));
            let at = point_f32(&self.positions, v);
            let tangent = carried.map(|t| [t[0], t[1], t[2]]);
            let bent = bend.vertex(fit, at, normal, tangent);
            let laid = [Some(bent.pos), bent.normal, bent.tangent];
            if laid.iter().flatten().flatten().any(|c| !c.is_finite()) {
                return Err(SPLINE.bad("the bend sends a vertex to a point that is not a number"));
            }
            done.positions.extend(bent.pos);
            done.normals
                .iter_mut()
                .zip(bent.normal)
                .for_each(|(into, n)| into.extend(n));
            let signed = (done.tangents.as_mut(), bent.tangent, carried);
            if let (Some(into), Some(turned), Some(source)) = signed {
                into.extend(turned);
                into.push(source[3] * mirror);
            }
        }
        Ok(done)
    }
}

/// Mesh `mesh` bent by `bend`, as a new mesh whose arrays are appended to `out`: each triangle
/// primitive read once, the box of them all the bend's extent, then each bent in turn.
fn bend_mesh(g: &mut Value, out: &mut Vec<u8>, mesh: usize, bend: &Bend) -> Result<Value> {
    let mut bent = item(values(g, "meshes")?, mesh, "mesh")?.clone();
    let primitives = values(&bent, "primitives")?.clone();
    let mut read = Vec::with_capacity(primitives.len());
    for p in &primitives {
        read.push(match triangles::is_triangle_list(p) {
            true => Some(Arrays::read(g, out, p)?),
            false => None,
        });
    }
    let points = read
        .iter()
        .flatten()
        .flat_map(|a| a.positions.as_chunks::<3>().0.iter().copied());
    let (low, high) = aabb_of_f32(points);
    if low[0] > high[0] {
        return Err(SPLINE.bad("the mesh has no triangle to bend"));
    }
    let fit = bend.fit((low, high));
    let mut done = Vec::with_capacity(primitives.len());
    for (p, arrays) in primitives.iter().zip(read) {
        done.push(match arrays {
            Some(arrays) => bend_primitive(g, out, p, arrays.bend((bend, fit))?, bend)?,
            None => p.clone(),
        });
    }
    bent["primitives"] = Value::Array(done);
    Ok(bent)
}

/// Primitive `p` with the `bent` arrays in place of its own: new accessors for its positions,
/// normals and tangents, and for its corners when the bend mirrors (turned over, so the surface
/// still faces out).
fn bend_primitive(
    g: &mut Value,
    out: &mut Vec<u8>,
    p: &Value,
    bent: Arrays,
    bend: &Bend,
) -> Result<Value> {
    let mut primitive = p.clone();
    let arrays = &mut primitive["attributes"];
    arrays["POSITION"] = json!(position_accessor(g, out, &bent.positions)?);
    if let Some(normals) = &bent.normals {
        arrays["NORMAL"] = json!(float_accessor(g, out, normals, ("VEC3", 3))?);
    }
    if let Some(tangents) = &bent.tangents {
        arrays["TANGENT"] = json!(float_accessor(g, out, tangents, ("VEC4", 4))?);
    }
    if bend.mirrors() {
        primitive["indices"] = json!(index_accessor(g, out, &bent.indices)?);
    }
    Ok(primitive)
}
