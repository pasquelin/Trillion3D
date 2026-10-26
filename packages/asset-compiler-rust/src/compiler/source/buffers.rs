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
            if uri.starts_with("data:") {
                let bytes = decode_data_uri(uri)?;
                if bytes.len() != required_index(buffer.get("byteLength"), "buffer.byteLength")? {
                    return Err(invalid(
                        "glTF data URI buffer length differs from byteLength",
                    ));
                }
                Binary::Owned(bytes)
            } else {
                // A sub-folder is allowed, as are `%XX` escapes; the key a sidecar is declared
                // under is the decoded relative path.
                let path = crate::support::uri::decode(uri)
                    .and_then(|decoded| safe_relative(&decoded, &['/']))
                    .ok_or_else(|| invalid("glTF buffer uri is required"))?;
                let map = map_source(&dir.join(&path))?;
                let digest = hash(&map);
                verify_sidecar(declared, &path, &digest)?;
                sidecars.push((path, digest));
                Binary::Mapped(map)
            }
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
/// The bytes of a `data:<mime>;base64,<data>` buffer URI; the mime must be `application/octet-stream`
/// or `application/gltf-buffer`, and the encoding base64, as a glTF buffer's is.
fn decode_data_uri(uri: &str) -> Result<Vec<u8>> {
    let bad = || invalid("Problem decoding glTF buffer from data URI");
    let (head, data) = uri.split_once(',').ok_or_else(bad)?;
    let (mime, encoding) = head["data:".len()..].split_once(';').ok_or_else(bad)?;
    if encoding != "base64"
        || !matches!(mime, "application/octet-stream" | "application/gltf-buffer")
    {
        return Err(bad());
    }
    let data = data.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(data.len() / 4 * 3 + 3);
    let (mut acc, mut bits) = (0u32, 0u32);
    for &c in data {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err(bad()),
        };
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Ok(out)
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
    for v in views.iter_mut() {
        let buffer = optional_index(v.get("buffer"), "bufferView.buffer", 0)?;
        if buffer >= offsets.len() {
            return Err(invalid(format!(
                "bufferView.buffer {buffer} is out of bounds"
            )));
        }
        let local = optional_index(v.get("byteOffset"), "bufferView.byteOffset", 0)?;
        let start = offsets[buffer]
            .checked_add(local)
            .ok_or_else(|| invalid("bufferView offset overflow"))?;
        let len = required_index(v.get("byteLength"), "bufferView.byteLength")?;
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
    }
    g["buffers"] = json!([{"byteLength":bin_len}]);
    Ok(())
}

/// Appends `data` to the binary `out` as one view of buffer 0 and names it by `accessor`, a glTF
/// accessor without its `bufferView` and `byteOffset`, pushed to the document's `accessors`;
/// returns the accessor's rank. The one writer of an accessor a pass makes over bytes of its own.
pub(crate) fn append_accessor(
    g: &mut Value,
    out: &mut Vec<u8>,
    mut accessor: Value,
    data: &[u8],
    target: Option<u32>,
) -> Result<usize> {
    // A glTF with no buffer view may leave the array out: the first view appended makes it.
    if g.get("bufferViews").is_none() {
        g["bufferViews"] = json!([]);
    }
    let views = g["bufferViews"]
        .as_array_mut()
        .ok_or_else(|| invalid("bufferViews array is required"))?;
    accessor["bufferView"] = json!(append_view(out, views, data, target));
    accessor["byteOffset"] = json!(0);
    let accessors = g["accessors"]
        .as_array_mut()
        .ok_or_else(|| invalid("accessors array is required"))?;
    accessors.push(accessor);
    Ok(accessors.len() - 1)
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
