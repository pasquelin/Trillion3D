use super::*;

/// Source bytes of an image and where they come from, the named view as
/// `source.gltf` publishes it. Provenance is the only part that needs the view
/// map: the rest also serves the cutout step, which only has the input scene.
pub(super) fn image_bytes(
    inputs: &PreviewInputs<'_>,
    image: &Value,
) -> std::result::Result<(Vec<u8>, PreviewSource), &'static str> {
    let (bytes, view) = raw_image_bytes(inputs.g, inputs.bin, inputs.image_root, image)?;
    let Some(view) = view else {
        return Ok((bytes, PreviewSource::Uri));
    };
    // Provenance names the view as `source.gltf` publishes it, not the input one.
    let mapped = *inputs
        .view_map
        .get(&view)
        .ok_or("image-buffer-view-not-copied")?;
    let mapped = u32::try_from(mapped).map_err(|_| "image-buffer-view-invalid")?;
    Ok((bytes, PreviewSource::BufferView(mapped)))
}

/// Source bytes of an image, and the INPUT glTF view when it is embedded there.
/// An embedded image is a slice of the already mapped binary; a linked image is
/// read once under the source folder, never written.
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
