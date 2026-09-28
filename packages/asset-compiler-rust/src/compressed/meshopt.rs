use super::*;

pub(super) fn expand(
    g: &mut Value,
    binary: Binary,
    offsets: &mut Vec<usize>,
    budget: &Budget<'_>,
) -> Result<Binary> {
    let mut jobs = Vec::new();
    let mut output_size = 0;
    for (id, view) in values(g, "bufferViews")?.iter().enumerate() {
        let Some(ext) = view.get("extensions").and_then(|v| v.get(MESHOPT)) else {
            continue;
        };
        let buffer = optional_index(view.get("buffer"), "bufferView.buffer", 0)?;
        let parent = item(values(g, "buffers")?, buffer, "bufferView.buffer")?;
        let offset = optional_index(view.get("byteOffset"), "bufferView.byteOffset", 0)?;
        if add(
            offset,
            required_index(view.get("byteLength"), "bufferView.byteLength")?,
        )? > required_index(parent.get("byteLength"), "buffer.byteLength")?
        {
            return Err(invalid("Meshopt view exceeds its declared fallback buffer"));
        }
        let count = required_index(ext.get("count"), "meshopt.count")?;
        let stride = required_index(ext.get("byteStride"), "meshopt.byteStride")?;
        let mode = ext.get("mode").and_then(Value::as_str).unwrap_or("");
        let filter = ext.get("filter").and_then(Value::as_str).unwrap_or("NONE");
        let valid_mode = match mode {
            "ATTRIBUTES" => stride > 0 && stride <= 256 && stride % 4 == 0,
            "TRIANGLES" => matches!(stride, 2 | 4) && count % 3 == 0 && filter == "NONE",
            "INDICES" => matches!(stride, 2 | 4) && filter == "NONE",
            _ => false,
        };
        let valid_filter = match filter {
            "NONE" => true,
            "OCTAHEDRAL" => matches!(stride, 4 | 8),
            "QUATERNION" => stride == 8,
            "EXPONENTIAL" => stride % 4 == 0,
            _ => false,
        };
        let length = product(count, stride)?;
        if !valid_mode
            || !valid_filter
            || count == 0
            || length != required_index(view.get("byteLength"), "bufferView.byteLength")?
            || view
                .get("byteStride")
                .is_some_and(|s| s.as_u64() != Some(stride as u64))
        {
            return Err(invalid("Invalid EXT_meshopt_compression layout"));
        }
        let range = source_range(g, offsets, ext, binary.bytes().len())?;
        let pad = crate::shared_math::pad_to_4(output_size);
        output_size = add(add(output_size, pad)?, length)?;
        jobs.push((id, range, count, stride, mode.to_owned(), filter.to_owned()));
    }
    if jobs.is_empty() {
        return Ok(binary);
    }
    let source = binary.bytes();
    let base = add(source.len(), crate::shared_math::pad_to_4(source.len()))?;
    let final_size = add(base, output_size)?;
    // Source and destination coexist during decode, including mapped source pages.
    budget.admit(add(source.len(), final_size)?)?;
    let mut out = reserve::<u8>(final_size)?;
    out.extend_from_slice(source);
    out.resize(final_size, 0);
    let buffer_id = values(g, "buffers")?.len();
    let mut cursor = base;
    for (id, range, count, stride, mode, filter) in jobs {
        budget.admit(add(source.len(), final_size)?)?;
        cursor = add(cursor, crate::shared_math::pad_to_4(cursor))?;
        let length = product(count, stride)?;
        decode(
            &mut out[cursor..cursor + length],
            &source[range],
            count,
            stride,
            &mode,
            &filter,
        )?;
        let view = &mut g["bufferViews"][id];
        view["buffer"] = json!(buffer_id);
        view["byteOffset"] = json!(cursor - base);
        view["extensions"].as_object_mut().unwrap().remove(MESHOPT);
        cursor += length;
    }
    g["buffers"]
        .as_array_mut()
        .unwrap()
        .push(json!({"byteLength": output_size}));
    offsets.push(base);
    Ok(Binary::Owned(out))
}
fn decode(
    out: &mut [u8],
    source: &[u8],
    count: usize,
    stride: usize,
    mode: &str,
    filter: &str,
) -> Result<()> {
    // Layout checks above meet meshoptimizer's FFI preconditions. Both ranges are
    // bounded, disjoint allocations; the decoder accepts untrusted encoded bytes.
    let status = unsafe {
        let dest = out.as_mut_ptr().cast();
        match mode {
            "ATTRIBUTES" => ::meshopt::ffi::meshopt_decodeVertexBuffer(
                dest,
                count,
                stride,
                source.as_ptr(),
                source.len(),
            ),
            "TRIANGLES" => ::meshopt::ffi::meshopt_decodeIndexBuffer(
                dest,
                count,
                stride,
                source.as_ptr(),
                source.len(),
            ),
            _ => ::meshopt::ffi::meshopt_decodeIndexSequence(
                dest,
                count,
                stride,
                source.as_ptr(),
                source.len(),
            ),
        }
    };
    if status != 0 {
        return Err(invalid("Invalid meshopt compressed stream"));
    }
    unsafe {
        let dest = out.as_mut_ptr().cast();
        match filter {
            "OCTAHEDRAL" => ::meshopt::ffi::meshopt_decodeFilterOct(dest, count, stride),
            "QUATERNION" => ::meshopt::ffi::meshopt_decodeFilterQuat(dest, count, stride),
            "EXPONENTIAL" => ::meshopt::ffi::meshopt_decodeFilterExp(dest, count, stride),
            _ => (),
        }
    }
    Ok(())
}
