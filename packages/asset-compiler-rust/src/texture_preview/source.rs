use super::*;

/// `inspect` over the source bytes of an image, borrowed, and where they come from, the named
/// view as `source.gltf` publishes it. Provenance is the only part that needs the view map: the
/// rest also serves the cutout step, which only has the input scene.
pub(super) fn image_bytes<T>(
    inputs: &PreviewInputs<'_>,
    image: &Value,
    inspect: impl FnOnce(&[u8], PreviewSource) -> std::result::Result<T, &'static str>,
) -> std::result::Result<T, &'static str> {
    with_image_bytes(
        inputs.g,
        inputs.bin,
        inputs.image_root,
        image,
        |bytes, view| {
            let Some(view) = view else {
                return inspect(bytes, PreviewSource::Uri);
            };
            // Provenance names the view as `source.gltf` publishes it, not the input one.
            let mapped = *inputs
                .view_map
                .get(&view)
                .ok_or("image-buffer-view-not-copied")?;
            let mapped = u32::try_from(mapped).map_err(|_| "image-buffer-view-invalid")?;
            inspect(bytes, PreviewSource::BufferView(mapped))
        },
    )
}

/// Inspect mapped or already resident bytes without allocating the encoded file again.
/// Like every mapped compiler input, the source must stay unchanged during its cook.
pub(crate) fn with_image_bytes<T>(
    g: &Value,
    bin: &[u8],
    image_root: &Path,
    image: &Value,
    inspect: impl FnOnce(&[u8], Option<usize>) -> std::result::Result<T, &'static str>,
) -> std::result::Result<T, &'static str> {
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
        return inspect(bytes, Some(view));
    }
    let uri = image
        .get("uri")
        .and_then(Value::as_str)
        .ok_or("image-without-source")?;
    let path = crate::uri::resolve_under(image_root, uri)?;
    let bytes = match crate::map_source(&path) {
        Ok(bytes) => bytes,
        Err(_) if fs::metadata(&path).is_ok_and(|m| m.len() == 0) => return inspect(&[], None),
        Err(_) => return Err("image-missing"),
    };
    inspect(&bytes, None)
}

/// The fingerprint of each image the compilation reads, by image index, taken once before any
/// step reads it: the cache key names the linked ones (`compiler_identity`), the cutout step
/// answers by it, the bake addresses its files by it. Every image the scene cites by URI is in —
/// identity covers an unused one too, absent or not —, and every image an atlas texture of a used
/// material reads. `None` is an image whose bytes do not read, or one no step reads.
pub(crate) struct ImageShas(Vec<Option<String>>);

impl ImageShas {
    /// The table of a scene no step reads an image of.
    #[cfg(test)]
    pub(crate) const EMPTY: &'static Self = &Self(Vec::new());

    /// Hashes the images side by side on the caller's pool, each from its borrowed bytes — a
    /// slice of the mapped binary or file —, never copied.
    pub(crate) fn of(
        g: &Value,
        bin: &[u8],
        image_root: &Path,
        used_materials: &BTreeSet<usize>,
    ) -> Self {
        let Some(images) = g.get("images").and_then(Value::as_array) else {
            return Self(Vec::new());
        };
        let textures = g.get("textures").and_then(Value::as_array);
        let read: BTreeSet<usize> = super::collect::atlas_textures(g, used_materials)
            .iter()
            .filter_map(|entry| textures?.get(entry.texture)?.get("source")?.as_u64())
            .map(|image| image as usize)
            .collect();
        let _t = perf::Timer::new(perf::Phase::CutoutScan);
        Self(
            images
                .par_iter()
                .enumerate()
                .map(|(index, image)| {
                    (image.get("uri").is_some() || read.contains(&index))
                        .then(|| with_image_bytes(g, bin, image_root, image, |b, _| Ok(hash(b))))?
                        .ok()
                })
                .collect(),
        )
    }

    /// The fingerprint of image `index`, when it was read.
    pub(crate) fn get(&self, index: usize) -> Option<&str> {
        self.0.get(index)?.as_deref()
    }
}
