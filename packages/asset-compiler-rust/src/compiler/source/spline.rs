//! Spline meshes: a node whose `extras.splineMesh` names a curve is drawn bent along it. The mesh
//! of the node is bent once, here, before anything reads it: each vertex goes where the curve's
//! slice at its distance puts it, its normal and tangent turn with the slice (`bend.rs`), and the
//! node takes the bent copy; the cluster DAG, the pages, the proxy and the collider are then built
//! of the bent mesh, so every error they hold is measured on the shape that is drawn.
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
//! A mesh the curve mirrors (its start scales differ in sign) has its triangles turned over. A
//! node whose mesh is skinned or morphed cannot be bent.
use crate::compiler::primitive::triangles;
use crate::compiler::source::synth::{attribute, float_accessor, index_accessor, owned, seal};
use crate::*;
use bend::{Bend, Bent, Fit, V3};
use read::{read_bend, refused};

mod bend;
mod read;

/// The key of a node's `extras` that names a spline mesh.
const SPLINE_EXTRA: &str = "splineMesh";

/// The nodes that name a spline and place a mesh: the node, its mesh and the bend. A node that
/// places no mesh bends nothing.
fn marked_nodes(g: &Value) -> Result<Vec<(usize, usize, Bend)>> {
    let Some(nodes) = g.get("nodes").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let meshes = g
        .get("meshes")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let mut marked = Vec::new();
    for (id, node) in nodes.iter().enumerate() {
        let spec = node.pointer(&format!("/extras/{SPLINE_EXTRA}"));
        let (Some(spec), Some(mesh)) = (spec.filter(|spec| !spec.is_null()), node.get("mesh"))
        else {
            continue;
        };
        let what = format!("nodes[{id}].extras.{SPLINE_EXTRA}");
        if node.get("skin").is_some() || node.get("weights").is_some() {
            return Err(refused(&what, "a skinned or morphed mesh cannot be bent"));
        }
        let mesh = bounded(mesh, "node.mesh", meshes)?;
        marked.push((id, mesh, read_bend(spec, &what)?));
    }
    Ok(marked)
}

/// Bends every mesh a node names a spline for, the node taking the bent copy; returns the binary
/// with the bent arrays appended. A document naming no spline is returned as it came.
pub(crate) fn bend_spline_meshes(g: &mut Value, binary: Binary) -> Result<Binary> {
    let marked = marked_nodes(g)?;
    if marked.is_empty() {
        return Ok(binary);
    }
    let mut out = owned(binary)?;
    for (node, mesh, bend) in marked {
        let bent = bend_mesh(g, &mut out, mesh, &bend)
            .map_err(|e| refused(&format!("nodes[{node}].extras.{SPLINE_EXTRA}"), e.message))?;
        let meshes = g["meshes"]
            .as_array_mut()
            .ok_or_else(|| invalid("meshes array is required"))?;
        meshes.push(bent);
        let placed = meshes.len() - 1;
        g["nodes"][node]["mesh"] = json!(placed);
        if let Some(extras) = g["nodes"][node]["extras"].as_object_mut() {
            extras.remove(SPLINE_EXTRA);
        }
    }
    seal(g, &out);
    Ok(Binary::Owned(out))
}

/// The box of the triangles of mesh `mesh`, over every vertex its triangle primitives hold.
fn mesh_bounds(g: &Value, bin: &[u8], mesh: usize) -> Result<(V3, V3)> {
    let (mut low, mut high) = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
    for (_, p) in triangles::mesh_primitives(g, mesh)? {
        let (positions, ..) = triangles::read(g, bin, p, None)?;
        for vertex in positions.collect_f32()?.chunks_exact(3) {
            for c in 0..3 {
                low[c] = low[c].min(vertex[c]);
                high[c] = high[c].max(vertex[c]);
            }
        }
    }
    if low[0] > high[0] {
        return Err(refused("the mesh", "it has no triangle to bend"));
    }
    Ok((low, high))
}

/// Mesh `mesh` bent by `bend`, as a new mesh whose arrays are appended to `out`.
fn bend_mesh(g: &mut Value, out: &mut Vec<u8>, mesh: usize, bend: &Bend) -> Result<Value> {
    let fit = bend.fit(mesh_bounds(g, out, mesh)?);
    let mut bent = item(values(g, "meshes")?, mesh, "mesh")?.clone();
    let primitives = values(&bent, "primitives")?.clone();
    let mut done = Vec::with_capacity(primitives.len());
    for p in &primitives {
        done.push(bend_primitive(g, out, p, (bend, fit))?);
    }
    bent["primitives"] = Value::Array(done);
    Ok(bent)
}

/// The three first floats of vertex `v` of an array of `width` floats a vertex.
fn at(values: &[f32], width: usize, v: usize) -> V3 {
    [
        values[v * width],
        values[v * width + 1],
        values[v * width + 2],
    ]
}

/// The arrays of a primitive after the bend.
struct BentArrays {
    positions: Vec<f32>,
    normals: Option<Vec<f32>>,
    tangents: Option<Vec<f32>>,
}

/// Bends the vertices of primitive `p`: `positions`, and the `normals` and `tangents` it may carry,
/// each vertex through `bend`. A vertex the bend sends to a point that is not a number is refused.
fn bend_vertices(
    (positions, normals, tangents): (&[f32], Option<&[f32]>, Option<&[f32]>),
    (bend, fit): (&Bend, Fit),
) -> Result<BentArrays> {
    let count = positions.len() / 3;
    let mut done = BentArrays {
        positions: Vec::with_capacity(positions.len()),
        normals: normals.map(|_| Vec::with_capacity(count * 3)),
        tangents: tangents.map(|_| Vec::with_capacity(count * 4)),
    };
    for v in 0..count {
        let Bent {
            pos,
            normal,
            tangent,
        } = bend.vertex(
            fit,
            at(positions, 3, v),
            normals.map(|n| at(n, 3, v)),
            tangents.map(|t| at(t, 4, v)),
        );
        let all = [Some(pos), normal, tangent];
        if all.iter().flatten().flatten().any(|c| !c.is_finite()) {
            return Err(refused(
                "the bend",
                "it sends a vertex to a point that is not a number",
            ));
        }
        done.positions.extend(pos);
        if let (Some(into), Some(normal)) = (done.normals.as_mut(), normal) {
            into.extend(normal);
        }
        if let (Some(into), Some(turned), Some(source)) =
            (done.tangents.as_mut(), tangent, tangents)
        {
            // The tangent's sign is the frame's handedness: the bend turns the frame alone.
            into.extend(turned);
            into.push(source[v * 4 + 3]);
        }
    }
    Ok(done)
}

/// Primitive `p` bent: its positions, normals and tangents new accessors, its triangles turned
/// over when the bend mirrors; a primitive that is no triangle list is left as it is.
fn bend_primitive(
    g: &mut Value,
    out: &mut Vec<u8>,
    p: &Value,
    (bend, fit): (&Bend, Fit),
) -> Result<Value> {
    if p.get("mode").is_some_and(|mode| mode != 4) {
        return Ok(p.clone());
    }
    let skinned = ["JOINTS_0", "WEIGHTS_0"]
        .iter()
        .any(|s| p.pointer(&format!("/attributes/{s}")).is_some());
    if skinned || p.get("targets").is_some() {
        return Err(refused(
            "the mesh",
            "a skinned or morphed mesh cannot be bent",
        ));
    }
    let (arrays, index_values) = {
        let (positions, index_values, _) = triangles::read(g, out, p, None)?;
        let positions = positions.collect_f32()?;
        let count = positions.len() / 3;
        let normals = attribute(g, out, p, ("NORMAL", &[3]), count)?.map(|(values, _)| values);
        let tangents = attribute(g, out, p, ("TANGENT", &[4]), count)?.map(|(values, _)| values);
        let source = (
            positions.as_slice(),
            normals.as_deref(),
            tangents.as_deref(),
        );
        (bend_vertices(source, (bend, fit))?, index_values)
    };
    let mut bent = p.clone();
    let id = float_accessor(g, out, &arrays.positions, 3, true)?;
    bent["attributes"]["POSITION"] = json!(id);
    if let Some(normals) = &arrays.normals {
        bent["attributes"]["NORMAL"] = json!(float_accessor(g, out, normals, 3, false)?);
    }
    if let Some(tangents) = &arrays.tangents {
        bent["attributes"]["TANGENT"] = json!(float_accessor(g, out, tangents, 4, false)?);
    }
    if bend.mirrors() {
        let turned: Vec<u32> = (index_values.chunks_exact(3))
            .flat_map(|t| [t[0], t[2], t[1]])
            .collect();
        bent["indices"] = json!(index_accessor(g, out, &turned)?);
    }
    Ok(bent)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A triangle on x from 0 to 1, bytes of its three positions, and a node placing it.
    fn document(extras: Value) -> (Value, Vec<u8>) {
        let bytes = [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let g = json!({
            "buffers": [{"byteLength": 36}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
            "nodes": [{"mesh": 0, "extras": {"splineMesh": extras}}],
        });
        (g, bytes)
    }

    fn bent_positions(g: &Value, bin: &[u8]) -> Vec<f32> {
        let id = g["meshes"][1]["primitives"][0]["attributes"]["POSITION"].as_u64();
        let reader = accessor(g, bin, id.expect("a bent position accessor") as usize, None);
        reader.expect("reads").collect_f32().expect("floats")
    }

    // Behaviour: a node naming a spline takes a bent copy of its mesh and the spline leaves its
    // extras; the reference's default curve, a straight line along x, leaves the mesh as it is.
    #[test]
    fn the_default_spline_leaves_the_mesh_as_it_is_in_a_copy_of_its_own() {
        let (mut g, bin) = document(json!({}));
        let bent = bend_spline_meshes(&mut g, Binary::Owned(bin)).expect("bends");
        assert_eq!(g["nodes"][0]["mesh"], 1);
        assert!(g["nodes"][0]["extras"].get("splineMesh").is_none());
        let expected: [f32; 9] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        assert_eq!(bent_positions(&g, bent.bytes()), expected);
    }

    // Behaviour: the scale across the curve stretches the mesh across it.
    #[test]
    fn a_scale_across_the_curve_stretches_the_mesh_across_it() {
        let spec = json!({"startScale": [2.0, 1.0], "endScale": [2.0, 1.0]});
        let (mut g, bin) = document(spec);
        let bent = bend_spline_meshes(&mut g, Binary::Owned(bin)).expect("bends");
        let positions = bent_positions(&g, bent.bytes());
        let expected: [f32; 9] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 2.0, 0.0];
        assert!(positions
            .iter()
            .zip(expected)
            .all(|(a, b)| (a - b).abs() < 1e-5));
    }

    // Behaviour: a field the spline does not have, and a value of the wrong kind, are refused by
    // name, and a skinned node cannot be bent.
    #[test]
    fn a_spline_that_does_not_read_is_refused_by_name() {
        for (spec, words) in [
            (json!({"startPoss": [0, 0, 0]}), "startPoss"),
            (json!({"endPos": [1, 0]}), "endPos"),
            (json!({"forwardAxis": "w"}), "forwardAxis"),
            (json!({"smoothInterpRollScale": 1}), "smoothInterpRollScale"),
        ] {
            let (mut g, bin) = document(spec);
            let refusal = bend_spline_meshes(&mut g, Binary::Owned(bin))
                .err()
                .expect("refused");
            assert!(refusal.message.contains(words), "{}", refusal.message);
        }
        let (mut g, bin) = document(json!({}));
        g["nodes"][0]["skin"] = json!(0);
        assert!(bend_spline_meshes(&mut g, Binary::Owned(bin)).is_err());
    }
}
