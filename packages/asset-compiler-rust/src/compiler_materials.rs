use super::*;

pub(super) fn unsplit_material(material: Option<&Value>) -> bool {
    let Some(material) = material else {
        return false;
    };
    material
        .get("extensions")
        .and_then(|e| e.get("KHR_materials_transmission"))
        .and_then(|t| t.get("transmissionFactor"))
        .and_then(Value::as_f64)
        .map(|v| v > 0.0)
        .unwrap_or(false)
}
/// Whether a material reads texture coordinate set `set`: every `textureInfo` it holds — base
/// colour, metal-roughness, normal, occlusion, emissive, or one an extension adds — names its set
/// in `texCoord`, 0 when absent. A page carries only the sets a material reads, as residency is
/// driven by what the frame reads; a material without a texture reads none.
pub(super) fn material_reads_texcoord(material: Option<&Value>, set: u64) -> bool {
    fn scan(value: &Value, set: u64) -> bool {
        match value {
            Value::Object(map) => {
                let texture = map.get("index").is_some_and(Value::is_number)
                    && map.get("texCoord").map_or(0, |t| t.as_u64().unwrap_or(0)) == set;
                texture || map.values().any(|v| scan(v, set))
            }
            Value::Array(items) => items.iter().any(|v| scan(v, set)),
            _ => false,
        }
    }
    material.is_some_and(|m| scan(m, set))
}

/// The attributes a page carries. Tangents are never read: a page carries none, the shader
/// rebuilds them. A texture coordinate set no texture of the material reads stays out of the
/// pages too, while the DAG still welds along it, so clusters do not depend on what a
/// material samples.
pub(super) fn carried_attributes<'a>(
    attributes: &'a [geometry_page::Attribute],
    material: Option<&Value>,
) -> Vec<&'a geometry_page::Attribute> {
    attributes
        .iter()
        .filter(|a| match a.flag {
            geometry_page::FLAG_UV => material_reads_texcoord(material, 0),
            geometry_page::FLAG_UV1 => material_reads_texcoord(material, 1),
            _ => true,
        })
        .collect()
}

pub(super) fn relative_image_uri(uri: &str) -> bool {
    !uri.is_empty() && !uri.starts_with("data:") && !uri.starts_with('/') && !uri.contains("://")
}
pub(super) fn rewrite_images(
    source: &mut Value,
    resource_base: &str,
    view_map: &BTreeMap<usize, usize>,
) -> Result<()> {
    let Some(images) = source.get_mut("images").and_then(Value::as_array_mut) else {
        return Ok(());
    };
    let base = resource_base.trim_end_matches('/');
    for image in images {
        if let Some(uri) = image.get("uri").and_then(Value::as_str) {
            if relative_image_uri(uri) {
                image["uri"] = json!(format!("{base}/{uri}"));
            }
        }
        if image.get("bufferView").is_some() {
            let old = required_index(image.get("bufferView"), "image.bufferView")?;
            let mapped = *view_map
                .get(&old)
                .ok_or_else(|| invalid("image.bufferView is not in the compacted buffer"))?;
            image["bufferView"] = json!(mapped);
        }
    }
    Ok(())
}
pub(super) fn validate_manifest(manifest: &Value) -> Result<()> {
    if manifest.get("status").and_then(Value::as_str) != Some("ready") {
        return Err(CompilerError::new(
            "SOURCE_NOT_READY",
            "Source manifest is not ready",
        ));
    }
    if let Some(version) = manifest.get("formatVersion").and_then(Value::as_u64) {
        if version != SOURCE_FORMAT_VERSION as u64 {
            return Err(CompilerError::new(
                "UNSUPPORTED_FORMAT",
                format!("Expected {SOURCE_FORMAT_VERSION}, received {version}"),
            ));
        }
    }
    Ok(())
}
pub(super) fn verify_sidecar(declared: Option<&Value>, uri: &str, actual: &str) -> Result<()> {
    let Some(manifest) = declared else {
        return Ok(());
    };
    let Some(sidecars) = manifest
        .get("runtime")
        .and_then(|r| r.get("sidecars"))
        .and_then(Value::as_array)
    else {
        return Ok(());
    };
    let sidecar = sidecars
        .iter()
        .find(|v| v.get("file").and_then(Value::as_str) == Some(uri))
        .ok_or_else(|| invalid("buffer sidecar hash is required"))?;
    if actual
        != sidecar
            .get("sha256")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("sidecar.sha256 is required"))?
    {
        return Err(CompilerError::new(
            "SOURCE_HASH_MISMATCH",
            "Binary hash differs from manifest",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod texcoord_tests {
    use super::material_reads_texcoord;
    use serde_json::json;

    #[test]
    fn a_material_reads_the_sets_its_textures_name_and_none_without_a_texture() {
        let lit = json!({"pbrMetallicRoughness":{"baseColorTexture":{"index":0}},
            "occlusionTexture":{"index":1,"texCoord":1}});
        assert!(material_reads_texcoord(Some(&lit), 0));
        assert!(material_reads_texcoord(Some(&lit), 1));
        assert!(!material_reads_texcoord(Some(&lit), 2));
        let bare = json!({"pbrMetallicRoughness":{"baseColorFactor":[1.0,0.0,0.0,1.0]}});
        assert!(!material_reads_texcoord(Some(&bare), 0));
        assert!(!material_reads_texcoord(None, 0));
        let extended = json!({"extensions":{"KHR_materials_clearcoat":{"clearcoatTexture":{"index":2,"texCoord":1}}}});
        assert!(material_reads_texcoord(Some(&extended), 1));
    }
}
