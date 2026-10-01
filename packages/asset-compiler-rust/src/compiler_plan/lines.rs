//! Validate carried line geometry after RAM admission; it has no triangle compilation job.
use super::*;

pub(super) fn validate(o: &Options, g: &Value, bin: &[u8], meshes: &BTreeSet<usize>) -> Result<()> {
    for &mesh in meshes {
        for p in values(item(values(g, "meshes")?, mesh, "mesh")?, "primitives")? {
            let mode = optional_index(p.get("mode"), "primitive.mode", 4)?;
            if !(1..=3).contains(&mode) {
                continue;
            }
            check(o)?;
            if p.get("targets").is_some() {
                return Err(invalid("Line morph targets are unsupported"));
            }
            let attributes = p["attributes"]
                .as_object()
                .ok_or_else(|| invalid("Line attributes missing"))?;
            let positions = accessor(
                g,
                bin,
                required_index(attributes.get("POSITION"), "POSITION")?,
                None,
            )?;
            if positions.width != 3 || positions.component != 5126 {
                return Err(invalid("Line POSITION must be float VEC3"));
            }
            for (name, id) in attributes {
                let data = accessor(g, bin, required_index(Some(id), "line attribute")?, None)?;
                if data.count != positions.count {
                    return Err(invalid("Line attribute counts differ"));
                }
                for value in data.collect_f32()? {
                    if !value.is_finite() {
                        return Err(invalid("Line attribute is non-finite"));
                    }
                }
                if name.starts_with("_LDRAW_CONTROL") && (data.width != 3 || data.component != 5126)
                {
                    return Err(invalid("Conditional line controls must be float VEC3"));
                }
            }
            let indices = if let Some(index) = p.get("indices") {
                let ids = accessor(g, bin, required_index(Some(index), "line indices")?, None)?;
                if ids.width != 1 {
                    return Err(invalid("Line indices must be SCALAR"));
                }
                let indices = ids.collect_u32()?;
                if indices
                    .iter()
                    .any(|&index| index as usize >= positions.count)
                {
                    return Err(invalid("Line index exceeds POSITION count"));
                }
                Some(indices)
            } else {
                None
            };
            let controls = attributes.contains_key("_LDRAW_CONTROL0")
                || attributes.contains_key("_LDRAW_CONTROL1");
            if controls
                && (mode != 1
                    || positions.count != 2
                    || !attributes.contains_key("_LDRAW_CONTROL0")
                    || !attributes.contains_key("_LDRAW_CONTROL1")
                    || indices.as_deref().is_some_and(|ids| ids != [0, 1]))
            {
                return Err(invalid(
                    "Conditional lines require two ordered endpoints and both controls",
                ));
            }
            let mut materials = BTreeSet::new();
            if let Some(material) = p.get("material") {
                materials.insert(required_index(Some(material), "material")?);
            }
            if let Some(extension) = p.pointer("/extensions/KHR_materials_variants") {
                for mapping in values(extension, "mappings")? {
                    materials.insert(required_index(mapping.get("material"), "variant material")?);
                }
            }
            for index in materials {
                let material = item(values(g, "materials")?, index, "material")?;
                if material
                    .pointer("/pbrMetallicRoughness/baseColorTexture")
                    .is_some()
                {
                    return Err(CompilerError::new(
                        "UNSUPPORTED_PRIMITIVE",
                        "Textured imported lines are unsupported",
                    ));
                }
            }
        }
    }
    Ok(())
}
