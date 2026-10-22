//! Arrays the spline pass writes into the document it read (`spline.rs`): bytes appended to the one
//! binary, each array with the view and the accessor that name it, so that every stage after the
//! load reads them as it reads the source's own.
use crate::compiler::accessor::codes::{ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, FLOAT, UNSIGNED_INT};
use crate::compiler::source::buffers::append_accessor;
use crate::support::le::{f32_bytes, u32_bytes};
use crate::*;
use trillion3d_math::geometry::aabb::aabb_of_f32;

/// A `VEC3` accessor over `positions`, laid after the binary's end, with the extremes glTF asks of
/// a position array; the accessor's rank.
pub(crate) fn position_accessor(
    g: &mut Value,
    out: &mut Vec<u8>,
    positions: &[f32],
) -> Result<usize> {
    let points = positions.as_chunks::<3>().0.iter().copied();
    let (low, high) = aabb_of_f32(points);
    let accessor = json!({
        "componentType": FLOAT, "count": positions.len() / 3, "type": "VEC3",
        "min": low, "max": high,
    });
    append_accessor(g, out, accessor, &f32_bytes(positions), Some(ARRAY_BUFFER))
}

/// A float accessor of `kind` (`"VEC3"`, `"VEC4"`) over `values`, `width` floats an element; its
/// rank.
pub(crate) fn float_accessor(
    g: &mut Value,
    out: &mut Vec<u8>,
    values: &[f32],
    (kind, width): (&str, usize),
) -> Result<usize> {
    let accessor = json!({"componentType": FLOAT, "count": values.len() / width, "type": kind});
    append_accessor(g, out, accessor, &f32_bytes(values), Some(ARRAY_BUFFER))
}

/// A 32-bit index accessor over `indices`; its rank.
pub(crate) fn index_accessor(g: &mut Value, out: &mut Vec<u8>, indices: &[u32]) -> Result<usize> {
    let accessor = json!({"componentType": UNSIGNED_INT, "count": indices.len(), "type": "SCALAR"});
    let bytes = u32_bytes(indices);
    append_accessor(g, out, accessor, &bytes, Some(ELEMENT_ARRAY_BUFFER))
}

/// The float attribute `semantic` of primitive `p`, `width` floats a vertex, one element for each
/// of `count` vertices; `None` when the primitive has none.
pub(crate) fn attribute(
    g: &Value,
    bin: &[u8],
    p: &Value,
    (semantic, width): (&str, usize),
    count: usize,
) -> Result<Option<Vec<f32>>> {
    let named = p.get("attributes").and_then(|a| a.get(semantic));
    let Some(id) = named else {
        return Ok(None);
    };
    let reader = accessor(g, bin, required_index(Some(id), semantic)?, None)?;
    if reader.width != width || reader.count != count {
        return Err(invalid(format!(
            "{semantic} must be a VEC{width} with one element a vertex"
        )));
    }
    Ok(Some(reader.collect_f32()?))
}

/// Declares the binary's final length once the pass has appended everything.
pub(crate) fn seal(g: &mut Value, out: &[u8]) {
    g["buffers"] = json!([{"byteLength": out.len()}]);
}
