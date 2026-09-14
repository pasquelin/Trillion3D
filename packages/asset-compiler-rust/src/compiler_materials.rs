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
