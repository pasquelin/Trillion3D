use super::*;

/// Les octets sources d'une image et d'où ils viennent. Une image embarquée est une tranche du
/// binaire déjà mappé, une image liée est lue une fois sous le dossier source, jamais écrite.
pub(super) fn image_bytes(
    inputs: &PreviewInputs<'_>,
    image: &Value,
) -> std::result::Result<(Vec<u8>, PreviewSource), &'static str> {
    if let Some(view) = image.get("bufferView").and_then(Value::as_u64) {
        let view = view as usize;
        let descriptor = inputs
            .g
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
        let bytes = inputs
            .bin
            .get(offset..end)
            .ok_or("image-buffer-view-out-of-bounds")?;
        // La provenance nomme la vue telle que `source.gltf` la publie, pas celle de l'entrée.
        let mapped = *inputs
            .view_map
            .get(&view)
            .ok_or("image-buffer-view-not-copied")?;
        let mapped = u32::try_from(mapped).map_err(|_| "image-buffer-view-invalid")?;
        return Ok((bytes.to_vec(), PreviewSource::BufferView(mapped)));
    }
    let uri = image
        .get("uri")
        .and_then(Value::as_str)
        .ok_or("image-without-source")?;
    if !relative_image_uri(uri) {
        return Err("image-uri-not-relative");
    }
    let relative = crate::uri::decode(uri).ok_or("image-uri-undecodable")?;
    let path = safe_join(inputs.image_root, &relative).ok_or("image-uri-outside-source")?;
    fs::read(&path)
        .map(|bytes| (bytes, PreviewSource::Uri))
        .map_err(|_| "image-missing")
}

/// Joint une URI relative à la racine des images sans jamais en sortir : chaque composant doit être
/// un nom de fichier ordinaire, ni `.`, ni `..`, ni racine, ni séparateur de plateforme.
fn safe_join(image_root: &Path, relative: &str) -> Option<PathBuf> {
    let mut path = image_root.to_path_buf();
    for component in relative.split('/') {
        if !is_safe_source_name(component) {
            return None;
        }
        path.push(component);
    }
    Some(path)
}
