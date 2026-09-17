use super::*;

/// Les octets sources d'une image et d'où ils viennent, la vue nommée telle que `source.gltf` la
/// publie. La provenance est la seule part qui demande la table de correspondance des vues : le
/// reste sert aussi à l'étape des découpes, qui n'a que la scène d'entrée sous la main.
pub(super) fn image_bytes(
    inputs: &PreviewInputs<'_>,
    image: &Value,
) -> std::result::Result<(Vec<u8>, PreviewSource), &'static str> {
    let (bytes, view) = raw_image_bytes(inputs.g, inputs.bin, inputs.image_root, image)?;
    let Some(view) = view else {
        return Ok((bytes, PreviewSource::Uri));
    };
    // La provenance nomme la vue telle que `source.gltf` la publie, pas celle de l'entrée.
    let mapped = *inputs
        .view_map
        .get(&view)
        .ok_or("image-buffer-view-not-copied")?;
    let mapped = u32::try_from(mapped).map_err(|_| "image-buffer-view-invalid")?;
    Ok((bytes, PreviewSource::BufferView(mapped)))
}

/// Les octets sources d'une image, et la vue du glTF D'ENTRÉE quand elle y est embarquée. Une image
/// embarquée est une tranche du binaire déjà mappé, une image liée est lue une fois sous le dossier
/// source, jamais écrite.
pub(crate) fn raw_image_bytes(
    g: &Value,
    bin: &[u8],
    image_root: &Path,
    image: &Value,
) -> std::result::Result<(Vec<u8>, Option<usize>), &'static str> {
    if let Some(view) = image.get("bufferView").and_then(Value::as_u64) {
        let view = view as usize;
        let descriptor = g
            .get("bufferViews")
            .and_then(Value::as_array)
            .and_then(|views| views.get(view))
            .ok_or("image-buffer-view-out-of-bounds")?;
        let offset = descriptor
            .get("byteOffset")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
        let length = descriptor
            .get("byteLength")
            .and_then(Value::as_u64)
            .ok_or("image-buffer-view-invalid")? as usize;
        let end = offset
            .checked_add(length)
            .ok_or("image-buffer-view-invalid")?;
        let bytes = bin
            .get(offset..end)
            .ok_or("image-buffer-view-out-of-bounds")?;
        return Ok((bytes.to_vec(), Some(view)));
    }
    let uri = image
        .get("uri")
        .and_then(Value::as_str)
        .ok_or("image-without-source")?;
    let path = crate::uri::resolve_under(image_root, uri)?;
    fs::read(&path)
        .map(|bytes| (bytes, None))
        .map_err(|_| "image-missing")
}
