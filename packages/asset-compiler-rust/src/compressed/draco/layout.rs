use super::*;

pub(super) fn validate(g: &Value, primitive: &Value, mesh: &Mesh, mode: usize) -> Result<()> {
    let compressed = primitive["extensions"][DRACO]["attributes"]
        .as_object()
        .ok_or_else(|| invalid("Draco attributes are required"))?;
    let attributes = primitive["attributes"]
        .as_object()
        .ok_or_else(|| invalid("Primitive attributes are required"))?;
    for (semantic, id) in attributes {
        let a = item(
            values(g, "accessors")?,
            required_index(Some(id), "attribute accessor")?,
            "accessor",
        )?;
        let count = required_index(a.get("count"), "accessor.count")?;
        // Attribute seams may increase the decoded point count. Only compressed
        // attributes gain those points; ordinary attributes must already agree.
        if count == 0
            || count > mesh.num_points()
            || (!compressed.contains_key(semantic) && count != mesh.num_points())
        {
            return Err(invalid("Draco vertex count differs from accessor data"));
        }
    }
    if let Some(targets) = primitive.get("targets").and_then(Value::as_array) {
        for target in targets {
            for id in target
                .as_object()
                .ok_or_else(|| invalid("Invalid morph target"))?
                .values()
            {
                let a = item(
                    values(g, "accessors")?,
                    required_index(Some(id), "morph accessor")?,
                    "accessor",
                )?;
                if required_index(a.get("count"), "accessor.count")? != mesh.num_points() {
                    return Err(invalid("Draco vertex count differs from morph target"));
                }
            }
        }
    }
    if let Some(id) = primitive.get("indices") {
        let a = item(
            values(g, "accessors")?,
            required_index(Some(id), "indices accessor")?,
            "accessor",
        )?;
        if a.get("type").and_then(Value::as_str) != Some("SCALAR")
            || !matches!(
                required_index(a.get("componentType"), "indices.componentType")?,
                5121 | 5123 | 5125
            )
            || (mode == 4
                && required_index(a.get("count"), "indices.count")?
                    != product(mesh.num_faces(), 3)?)
        {
            return Err(invalid("Draco topology differs from index accessor"));
        }
    }
    Ok(())
}
