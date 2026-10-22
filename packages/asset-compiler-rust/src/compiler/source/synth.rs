//! Arrays the compiler writes into the document it read, as a pass before the plan: bytes appended
//! to the one binary, each array with the view and the accessor that name it, so that every stage
//! after the load reads them as it reads the source's own (`spline.rs`, `assembly.rs`).
use crate::compiler::accessor::codes::{ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, FLOAT, UNSIGNED_INT};
use crate::compiler::source::buffers::append_view;
use crate::*;

/// The `type` of an accessor of `width` floats, none for a width glTF has no vector of.
fn kind_of(width: usize) -> Option<&'static str> {
    ["SCALAR", "VEC2", "VEC3", "VEC4"]
        .get(width.checked_sub(1)?)
        .copied()
}

/// The binary as a vector the pass can grow: the bytes themselves when it owns them, else a copy.
pub(crate) fn owned(binary: Binary) -> Result<Vec<u8>> {
    match binary {
        Binary::Owned(bytes) => Ok(bytes),
        mapped => {
            let bytes = mapped.bytes();
            let mut out = reserve(bytes.len())?;
            out.extend_from_slice(bytes);
            Ok(out)
        }
    }
}

/// Appends `bytes` to the binary `out` as one view, and an accessor of `count` elements of
/// `component` and `kind` over it; returns the accessor's rank. `extra` joins the accessor's fields
/// (`min`, `max`).
fn append_accessor(
    g: &mut Value,
    out: &mut Vec<u8>,
    (bytes, target): (&[u8], u32),
    (count, component, kind): (usize, usize, &str),
    extra: Option<Value>,
) -> Result<usize> {
    let views = g["bufferViews"]
        .as_array_mut()
        .ok_or_else(|| invalid("bufferViews array is required"))?;
    let view = append_view(out, views, bytes, Some(target));
    let mut accessor = json!({
        "bufferView": view, "byteOffset": 0, "componentType": component, "count": count, "type": kind,
    });
    if let (Some(Value::Object(fields)), Some(map)) = (extra, accessor.as_object_mut()) {
        map.extend(fields);
    }
    let accessors = g["accessors"]
        .as_array_mut()
        .ok_or_else(|| invalid("accessors array is required"))?;
    accessors.push(accessor);
    Ok(accessors.len() - 1)
}

/// A float accessor of `width` components over `values`, laid after the binary's end; the rank of
/// the accessor. A position array (`width` 3, `bounds`) names its extremes, as glTF asks.
pub(crate) fn float_accessor(
    g: &mut Value,
    out: &mut Vec<u8>,
    values: &[f32],
    width: usize,
    bounds: bool,
) -> Result<usize> {
    let kind = kind_of(width).ok_or_else(|| invalid("A synthesized accessor has no such width"))?;
    let mut bytes: Vec<u8> = reserve(values.len() * 4)?;
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    let count = values.len() / width;
    let extra = bounds.then(|| {
        let mut low = vec![f32::INFINITY; width];
        let mut high = vec![f32::NEG_INFINITY; width];
        for element in values.chunks_exact(width) {
            for (c, &value) in element.iter().enumerate() {
                low[c] = low[c].min(value);
                high[c] = high[c].max(value);
            }
        }
        json!({"min": low, "max": high})
    });
    append_accessor(
        g,
        out,
        (bytes.as_slice(), ARRAY_BUFFER),
        (count, FLOAT, kind),
        extra,
    )
}

/// An index accessor over `indices`, 32-bit; its rank.
pub(crate) fn index_accessor(g: &mut Value, out: &mut Vec<u8>, indices: &[u32]) -> Result<usize> {
    let mut bytes: Vec<u8> = reserve(indices.len() * 4)?;
    for index in indices {
        bytes.extend_from_slice(&index.to_le_bytes());
    }
    let shape = (indices.len(), UNSIGNED_INT, "SCALAR");
    append_accessor(
        g,
        out,
        (bytes.as_slice(), ELEMENT_ARRAY_BUFFER),
        shape,
        None,
    )
}

/// The float attribute `semantic` of primitive `p`, one element a vertex of `count`, of one of
/// `widths` floats: its values and its width; `None` when the primitive has none. Normalized
/// integers read as the floats they stand for.
pub(crate) fn attribute(
    g: &Value,
    bin: &[u8],
    p: &Value,
    (semantic, widths): (&str, &[usize]),
    count: usize,
) -> Result<Option<(Vec<f32>, usize)>> {
    let Some(id) = p.pointer(&format!("/attributes/{semantic}")) else {
        return Ok(None);
    };
    let reader = accessor(g, bin, required_index(Some(id), semantic)?, None)?;
    if !widths.contains(&reader.width) || reader.count != count {
        let wanted: Vec<String> = widths.iter().map(|w| format!("VEC{w}")).collect();
        return Err(invalid(format!(
            "{semantic} must be a {} with one element a vertex",
            wanted.join(" or ")
        )));
    }
    let width = reader.width;
    Ok(Some((reader.collect_f32()?, width)))
}

/// Declares the binary's final length once the pass has appended everything.
pub(crate) fn seal(g: &mut Value, out: &[u8]) {
    g["buffers"] = json!([{"byteLength": out.len()}]);
}
