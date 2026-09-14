use super::*;

type GltfBuffers = (Binary, Vec<usize>, Vec<(String, String)>);

pub(super) fn concat_gltf_buffers(
    dir: &Path,
    g: &Value,
    embedded: Option<&[u8]>,
    declared: Option<&Value>,
) -> Result<GltfBuffers> {
    let buffers = values(g, "buffers")?;
    if buffers.is_empty() {
        return Err(invalid("glTF buffers are required"));
    }
    if buffers.len() == 1 {
        if let Some(uri) = buffers[0]
            .get("uri")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            if !is_safe_source_name(uri) {
                return Err(invalid("glTF buffer uri is required"));
            }
            let digest = hash_file(&dir.join(uri))?;
            verify_sidecar(declared, uri, &digest)?;
            let file = File::open(dir.join(uri))?;
            let map = unsafe { memmap2::MmapOptions::new().map(&file)? };
            if required_index(buffers[0].get("byteLength"), "buffer.byteLength")? > map.len() {
                return Err(invalid("glTF buffer byteLength exceeds source bytes"));
            }
            return Ok((
                Binary::Mapped(map),
                vec![0],
                vec![(uri.to_string(), digest)],
            ));
        }
        if let Some(bin) = embedded {
            if required_index(buffers[0].get("byteLength"), "buffer.byteLength")? > bin.len() {
                return Err(invalid("glTF buffer byteLength exceeds source bytes"));
            }
            return Ok((Binary::Owned(bin.to_vec()), vec![0], Vec::new()));
        }
    }
    let mut out = Vec::new();
    let mut offsets = Vec::new();
    let mut sidecars = Vec::new();
    for (i, buffer) in buffers.iter().enumerate() {
        let pad = (4 - out.len() % 4) % 4;
        out.extend(std::iter::repeat_n(0u8, pad));
        offsets.push(out.len());
        if let Some(uri) = buffer
            .get("uri")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            if !is_safe_source_name(uri) {
                return Err(invalid("glTF buffer uri is required"));
            }
            let bytes = fs::read(dir.join(uri))?;
            if required_index(buffer.get("byteLength"), "buffer.byteLength")? > bytes.len() {
                return Err(invalid("glTF buffer byteLength exceeds source bytes"));
            }
            let digest = hash(&bytes);
            verify_sidecar(declared, uri, &digest)?;
            sidecars.push((uri.to_string(), digest));
            out.extend_from_slice(&bytes);
        } else if i == 0 {
            let bin = embedded.ok_or_else(|| invalid("glTF buffer uri is required"))?;
            if required_index(buffer.get("byteLength"), "buffer.byteLength")? > bin.len() {
                return Err(invalid("glTF buffer byteLength exceeds source bytes"));
            }
            out.extend_from_slice(bin);
        } else {
            return Err(invalid("glTF buffer uri is required"));
        }
    }
    Ok((Binary::Owned(out), offsets, sidecars))
}
pub(super) fn flatten_buffer_views(g: &mut Value, offsets: &[usize], bin_len: usize) -> Result<()> {
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
