//! The sparse substitution of an accessor: where its indices and values start, and when checked,
//! that they fit, align and name strictly increasing elements.
use super::{range, Sparse};
use crate::compiler_accessor_types::index_value;
use crate::gltf_codes::index_bytes_of;
use crate::{invalid, item, optional_index, required_index, Result};
use serde_json::Value;

/// The sparse substitution of an accessor of `count` elements of `element_bytes`, components of
/// `bytes`; when `check`, its count, alignment, bounds and strictly increasing indices.
pub(super) fn sparse_layout(
    sparse: &Value,
    views: &[Value],
    bin: &[u8],
    (count, bytes, element_bytes): (usize, usize, usize),
    check: bool,
) -> Result<Sparse> {
    let sparse_count = required_index(sparse.get("count"), "sparse.count")?;
    let indices = sparse
        .get("indices")
        .ok_or_else(|| invalid("sparse.indices is required"))?;
    let vals = sparse
        .get("values")
        .ok_or_else(|| invalid("sparse.values is required"))?;
    let index_component =
        required_index(indices.get("componentType"), "sparse.indices.componentType")?;
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
    let io = optional_index(indices.get("byteOffset"), "sparse.indices.byteOffset", 0)?;
    let vo = optional_index(vals.get("byteOffset"), "sparse.values.byteOffset", 0)?;
    let start = |view: &Value, offset: usize| -> Result<usize> {
        optional_index(view.get("byteOffset"), "bufferView.byteOffset", 0)?
            .checked_add(offset)
            .ok_or_else(|| invalid("Sparse offset overflow"))
    };
    let out = Sparse {
        count: sparse_count,
        indices_offset: start(iv, io)?,
        indices_component: index_component,
        values_offset: start(vv, vo)?,
    };
    if !check {
        return Ok(out);
    }
    if sparse_count == 0 || sparse_count > count {
        return Err(invalid("sparse.count exceeds accessor count"));
    }
    let index_bytes = index_bytes_of(index_component)
        .ok_or_else(|| invalid("sparse indices component is invalid"))?;
    if iv.get("byteStride").is_some() || vv.get("byteStride").is_some() {
        return Err(invalid("sparse bufferViews cannot have a stride"));
    }
    if io % index_bytes != 0
        || vo % bytes != 0
        || out.indices_offset % index_bytes != 0
        || out.values_offset % bytes != 0
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
        let index = index_value(index_component, &bin[at..])
            .ok_or_else(|| invalid("sparse indices are out of bounds"))?
            as usize;
        if index >= count || previous.is_some_and(|p| index <= p) {
            return Err(invalid(
                "sparse indices must be strictly increasing and in range",
            ));
        }
        previous = Some(index);
    }
    Ok(out)
}
