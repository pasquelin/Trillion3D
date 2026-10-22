//! A primitive's triangles as every reader takes them — the compiler, the physics cook, the
//! traced surfaces and the reference tracer: its float `POSITION` accessor, and its index list —
//! an unsigned `SCALAR` accessor of whole triangles naming vertices `POSITION` carries, or the
//! positions in order when the primitive has none.
use super::*;
use crate::compiler::accessor::codes::{FLOAT, INDEX_COMPONENTS};

/// The positions accessor of primitive `p`, its index list and its triangle count. `validated`
/// names the accessors an upstream pass already validated (`accessor`); `None` validates both.
pub(crate) fn read<'a>(
    g: &'a Value,
    bin: &'a [u8],
    p: &Value,
    validated: Option<&BTreeSet<usize>>,
) -> Result<(Accessor<'a>, Vec<u32>, usize)> {
    let positions = accessor(
        g,
        bin,
        required_index(
            p.get("attributes")
                .and_then(Value::as_object)
                .and_then(|a| a.get("POSITION")),
            "primitive.attributes.POSITION",
        )?,
        validated,
    )?;
    if positions.width != 3 || positions.component != FLOAT {
        return Err(invalid("POSITION must be float VEC3"));
    }
    let (index_values, triangle_count) = if p.get("indices").is_some() {
        let ids = accessor(
            g,
            bin,
            required_index(p.get("indices"), "primitive.indices")?,
            validated,
        )?;
        if ids.width != 1 || ids.normalized || !INDEX_COMPONENTS.contains(&ids.component) {
            return Err(invalid("indices component must be unsigned SCALAR"));
        }
        if ids.count == 0 || ids.count % 3 != 0 {
            return Err(CompilerError::new(
                "INVALID_TRIANGLES",
                "Index count must be a positive multiple of three",
            ));
        }
        (ids.collect_u32()?, ids.count / 3)
    } else {
        if positions.count == 0 || positions.count % 3 != 0 {
            return Err(invalid(
                "Unindexed POSITION count must be a positive multiple of three",
            ));
        }
        ((0..positions.count as u32).collect(), positions.count / 3)
    };
    if index_values.iter().any(|&i| i as usize >= positions.count) {
        return Err(CompilerError::new(
            "INVALID_TRIANGLES",
            "An index names a vertex POSITION does not carry",
        ));
    }
    Ok((positions, index_values, triangle_count))
}

/// Whether primitive `p` draws triangles (`mode` 4, the default).
pub(crate) fn is_triangle_list(p: &Value) -> bool {
    p.get("mode").is_none_or(|m| m == 4)
}

/// Whether primitive `p` moves with nothing but its node: no bones, no morph targets.
pub(crate) fn is_rigid(p: &Value) -> bool {
    let bone = |semantic: &str| p.get("attributes").and_then(|a| a.get(semantic)).is_some();
    p.get("targets").is_none() && !bone("JOINTS_0") && !bone("WEIGHTS_0")
}

/// The triangle primitives of mesh `mesh` (mode 4, the default), as declared, each with its index
/// among the mesh's primitives.
pub(crate) fn mesh_primitives(
    g: &Value,
    mesh: usize,
) -> Result<impl Iterator<Item = (usize, &Value)>> {
    let primitives = values(item(values(g, "meshes")?, mesh, "mesh")?, "primitives")?;
    Ok(primitives
        .iter()
        .enumerate()
        .filter(|(_, p)| is_triangle_list(p)))
}

/// Positions and triangles of every triangle primitive of mesh `mesh`, one list each, a
/// primitive's indices moved past the positions before its own.
pub(crate) fn mesh_triangles(g: &Value, bin: &[u8], mesh: usize) -> Result<(Vec<f32>, Vec<u32>)> {
    let (mut pos, mut triangles) = (Vec::new(), Vec::new());
    for (_, p) in mesh_primitives(g, mesh)? {
        let base = (pos.len() / 3) as u32;
        let (positions, local, _) = read(g, bin, p, None)?;
        pos.extend(positions.collect_f32()?);
        triangles.extend(local.iter().map(|i| i + base));
    }
    Ok((pos, triangles))
}
