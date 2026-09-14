use crate::{invalid, item, optional_index, required_index, values, Result};
use serde_json::Value;

fn range(
    view: &Value,
    bin: &[u8],
    offset: usize,
    stride: usize,
    count: usize,
    size: usize,
    label: &str,
) -> Result<usize> {
    let start = optional_index(view.get("byteOffset"), "bufferView.byteOffset", 0)?;
    let length = required_index(view.get("byteLength"), "bufferView.byteLength")?;
    let extent = offset
        .checked_add(
            count
                .saturating_sub(1)
                .checked_mul(stride)
                .ok_or_else(|| invalid("Accessor extent overflow"))?,
        )
        .and_then(|v| v.checked_add(size))
        .ok_or_else(|| invalid("Accessor extent overflow"))?;
    if extent > length {
        return Err(invalid(format!("{label} exceeds its bufferView")));
    }
    let base = start
        .checked_add(offset)
        .ok_or_else(|| invalid("Accessor offset overflow"))?;
    if base
        .checked_add(extent - offset)
        .filter(|&end| end <= bin.len())
        .is_none()
    {
        return Err(invalid(format!("{label} exceeds binary buffer")));
    }
    Ok(base)
}

pub fn validate(g: &Value, bin: &[u8], id: usize) -> Result<()> {
    let a = item(values(g, "accessors")?, id, "accessor")?;
    let views = values(g, "bufferViews")?;
    let component = required_index(a.get("componentType"), "accessor.componentType")?;
    let bytes: usize = match component {
        5120 | 5121 => 1,
        5122 | 5123 => 2,
        5125 | 5126 => 4,
        _ => return Err(invalid("Unsupported accessor component")),
    };
    let (columns, rows) = match a.get("type").and_then(Value::as_str) {
        Some("SCALAR") => (1, 1),
        Some("VEC2") => (1, 2),
        Some("VEC3") => (1, 3),
        Some("VEC4") => (1, 4),
        Some("MAT2") => (2, 2),
        Some("MAT3") => (3, 3),
        Some("MAT4") => (4, 4),
        _ => return Err(invalid("Unsupported accessor type")),
    };
    let element_bytes = if columns == 1 {
        rows * bytes
    } else {
        columns
            * if bytes < 4 {
                (rows * bytes).div_ceil(4) * 4
            } else {
                rows * bytes
            }
    };
    let count = required_index(a.get("count"), "accessor.count")?;
    if count == 0 {
        return Err(invalid("accessor.count must be positive"));
    }
    if let Some(view_id) = a.get("bufferView") {
        let view = item(
            views,
            required_index(Some(view_id), "accessor.bufferView")?,
            "bufferView",
        )?;
        let offset = optional_index(a.get("byteOffset"), "accessor.byteOffset", 0)?;
        let stride = optional_index(
            view.get("byteStride"),
            "bufferView.byteStride",
            element_bytes,
        )?;
        if stride < element_bytes
            || stride % bytes != 0
            || offset % bytes != 0
            || optional_index(view.get("byteOffset"), "bufferView.byteOffset", 0)? % bytes != 0
        {
            return Err(invalid("Accessor stride or alignment is invalid"));
        }
        range(view, bin, offset, stride, count, element_bytes, "accessor")?;
    } else if a.get("sparse").is_none()
        || optional_index(a.get("byteOffset"), "accessor.byteOffset", 0)? != 0
    {
        return Err(invalid("accessor requires bufferView unless sparse"));
    }
    if let Some(sparse) = a.get("sparse") {
        let sparse_count = required_index(sparse.get("count"), "sparse.count")?;
        if sparse_count == 0 || sparse_count > count {
            return Err(invalid("sparse.count exceeds accessor count"));
        }
        let indices = sparse
            .get("indices")
            .ok_or_else(|| invalid("sparse.indices is required"))?;
        let vals = sparse
            .get("values")
            .ok_or_else(|| invalid("sparse.values is required"))?;
        let index_bytes =
            match required_index(indices.get("componentType"), "sparse.indices.componentType")? {
                5121 => 1,
                5123 => 2,
                5125 => 4,
                _ => return Err(invalid("sparse indices component is invalid")),
            };
        let iv = item(
            views,
            required_index(indices.get("bufferView"), "sparse.indices.bufferView")?,
            "bufferView",
        )?;
        let vv = item(
            views,
            required_index(vals.get("bufferView"), "sparse.values.bufferView")?,
            "bufferView",
        )?;
        if iv.get("byteStride").is_some() || vv.get("byteStride").is_some() {
            return Err(invalid("sparse bufferViews cannot have a stride"));
        }
        let io = optional_index(indices.get("byteOffset"), "sparse.indices.byteOffset", 0)?;
        let vo = optional_index(vals.get("byteOffset"), "sparse.values.byteOffset", 0)?;
        if io % index_bytes != 0
            || vo % bytes != 0
            || optional_index(iv.get("byteOffset"), "bufferView.byteOffset", 0)? % index_bytes != 0
            || optional_index(vv.get("byteOffset"), "bufferView.byteOffset", 0)? % bytes != 0
        {
            return Err(invalid("sparse alignment is invalid"));
        }
        let base = range(
            iv,
            bin,
            io,
            index_bytes,
            sparse_count,
            index_bytes,
            "sparse indices",
        )?;
        range(
            vv,
            bin,
            vo,
            element_bytes,
            sparse_count,
            element_bytes,
            "sparse values",
        )?;
        let mut previous = None;
        for k in 0..sparse_count {
            let at = base + k * index_bytes;
            let index = match index_bytes {
                1 => bin[at] as usize,
                2 => u16::from_le_bytes([bin[at], bin[at + 1]]) as usize,
                _ => u32::from_le_bytes([bin[at], bin[at + 1], bin[at + 2], bin[at + 3]]) as usize,
            };
            if index >= count || previous.is_some_and(|p| index <= p) {
                return Err(invalid(
                    "sparse indices must be strictly increasing and in range",
                ));
            }
            previous = Some(index);
        }
    }
    Ok(())
}
