use crate::*;

type GltfBuffers = (Binary, Vec<usize>, Vec<(String, String)>);

/// The document's buffers as one binary, each started on a 4-byte boundary, with each buffer's
/// offset in it and the digest of each sidecar read; `flatten_buffer_views` then points every view
/// at buffer 0. A sidecar's digest must match its `runtime.sidecars[]` entry when a manifest
/// declares one; a GLB's BIN chunk carries no sidecar digest. Every buffer is resolved and checked
/// by one walk; a document of one buffer is that buffer itself, mapped or embedded, never copied.
pub(crate) fn concat_gltf_buffers(
    dir: &Path,
    g: &Value,
    mut embedded: Option<Binary>,
    declared: Option<&Value>,
) -> Result<GltfBuffers> {
    let buffers = values(g, "buffers")?;
    if buffers.is_empty() {
        return Err(invalid("glTF buffers are required"));
    }
    // `None` is a buffer EXT_meshopt_compression leaves without its uncompressed fallback.
    let mut parts: Vec<Option<Binary>> = Vec::with_capacity(buffers.len());
    let mut sidecars = Vec::new();
    for (i, buffer) in buffers.iter().enumerate() {
        let part = if let Some(uri) = buffer
            .get("uri")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            if !is_safe_source_name(uri) {
                return Err(invalid("glTF buffer uri is required"));
            }
            let map = map_source(&dir.join(uri))?;
            let digest = hash(&map);
            verify_sidecar(declared, uri, &digest)?;
            sidecars.push((uri.to_string(), digest));
            Binary::Mapped(map)
        } else if load::compressed::placeholder(g, i) && (i != 0 || embedded.is_none()) {
            parts.push(None);
            continue;
        } else if i == 0 {
            embedded
                .take()
                .ok_or_else(|| invalid("glTF buffer uri is required"))?
        } else {
            return Err(invalid("glTF buffer uri is required"));
        };
        if required_index(buffer.get("byteLength"), "buffer.byteLength")? > part.bytes().len() {
            return Err(invalid("glTF buffer byteLength exceeds source bytes"));
        }
        parts.push(Some(part));
    }
    if let [Some(_)] = parts.as_slice() {
        if let Some(Some(only)) = parts.pop() {
            return Ok((only, vec![0], sidecars));
        }
    }
    let mut out = Vec::new();
    let mut offsets = Vec::with_capacity(parts.len());
    for part in &parts {
        let Some(part) = part else {
            offsets.push(usize::MAX);
            continue;
        };
        out.resize(out.len() + crate::shared_math::pad_to_4(out.len()), 0);
        offsets.push(out.len());
        out.extend_from_slice(part.bytes());
    }
    Ok((Binary::Owned(out), offsets, sidecars))
}
pub(crate) fn flatten_buffer_views(g: &mut Value, offsets: &[usize], bin_len: usize) -> Result<()> {
    let declared: Vec<usize> = values(g, "buffers")?
        .iter()
        .map(|b| required_index(b.get("byteLength"), "buffer.byteLength"))
        .collect::<Result<_>>()?;
    let views = g
        .get_mut("bufferViews")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| invalid("bufferViews array is required"))?;
    for (id, v) in views.iter_mut().enumerate() {
        let buffer = optional_index(v.get("buffer"), "bufferView.buffer", 0)?;
        if buffer >= offsets.len() {
            return Err(invalid(format!(
                "bufferView.buffer {buffer} is out of bounds"
            )));
        }
        let start = offsets[buffer]
            .checked_add(optional_index(
                v.get("byteOffset"),
                "bufferView.byteOffset",
                0,
            )?)
            .ok_or_else(|| invalid("bufferView offset overflow"))?;
        let len = required_index(v.get("byteLength"), "bufferView.byteLength")?;
        let local = optional_index(v.get("byteOffset"), "bufferView.byteOffset", 0)?;
        if local
            .checked_add(len)
            .filter(|&end| end <= declared[buffer])
            .is_none()
        {
            return Err(invalid("bufferView exceeds declared buffer bounds"));
        }
        let end = start
            .checked_add(len)
            .ok_or_else(|| invalid("bufferView range overflow"))?;
        if end > bin_len {
            return Err(CompilerError::new(
                "BUFFER_OUT_OF_BOUNDS",
                "bufferView exceeds binary buffer",
            ));
        }
        v["buffer"] = json!(0);
        v["byteOffset"] = json!(start);
        let _id = id;
    }
    g["buffers"] = json!([{"byteLength":bin_len}]);
    Ok(())
}

/// Appends `data` to `bytes` at the next four-aligned offset, and its view of buffer 0 to `views`;
/// returns the view's rank.
pub(crate) fn append_view(
    bytes: &mut Vec<u8>,
    views: &mut Vec<Value>,
    data: &[u8],
    target: Option<u32>,
) -> usize {
    let pad = crate::shared_math::pad_to_4(bytes.len());
    bytes.extend(std::iter::repeat_n(0u8, pad));
    let offset = bytes.len();
    bytes.extend_from_slice(data);
    let mut view = json!({"buffer":0,"byteOffset":offset,"byteLength":data.len()});
    if let Some(t) = target {
        view["target"] = json!(t);
    }
    views.push(view);
    views.len() - 1
}
