//! An accessor's layout, read once: its component, shape, count, view, stride and sparse
//! substitution. The upfront validation of every accessor (`plan_buffers`) and the reader
//! (`accessor`) take this one parse; `check` adds the bounds, alignment and ordering checks a
//! layout not yet validated needs.
use crate::gltf_codes::{component_bytes, element_shape};
use crate::{invalid, item, optional_index, required_index, values, CompilerError, Result};
use serde_json::Value;
use sparse::sparse_layout;

mod sparse;

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

/// A sparse substitution: its count, and where its indices and values start in the binary.
pub(crate) struct Sparse {
    pub(crate) count: usize,
    pub(crate) indices_offset: usize,
    pub(crate) indices_component: usize,
    pub(crate) values_offset: usize,
}

/// What an accessor declares, parsed once.
pub(crate) struct Layout {
    pub(crate) component: usize,
    pub(crate) bytes: usize,
    /// `(columns, rows)`, a vector being one column (`element_shape`).
    pub(crate) shape: (usize, usize),
    pub(crate) count: usize,
    pub(crate) normalized: bool,
    /// Where the first element starts in the binary, `None` without a view.
    pub(crate) base: Option<usize>,
    pub(crate) stride: usize,
    pub(crate) sparse: Option<Sparse>,
}

/// Validates accessor `id` of `g` over `bin`.
pub fn validate(g: &Value, bin: &[u8], id: usize) -> Result<()> {
    layout(g, bin, id, true).map(|_| ())
}

/// The layout of accessor `id`, checked when `check` (otherwise an upstream pass validated it).
pub(crate) fn layout(g: &Value, bin: &[u8], id: usize, check: bool) -> Result<Layout> {
    let a = item(values(g, "accessors")?, id, "accessor")?;
    let views = values(g, "bufferViews")?;
    let component = required_index(a.get("componentType"), "accessor.componentType")?;
    let bytes =
        component_bytes(component).ok_or_else(|| invalid("Unsupported accessor component"))?;
    let (columns, rows) = a
        .get("type")
        .and_then(Value::as_str)
        .and_then(element_shape)
        .ok_or_else(|| invalid("Unsupported accessor type"))?;
    // A matrix column of small components is padded to four bytes.
    let element_bytes = match (columns, bytes < 4) {
        (1, _) | (_, false) => columns * rows * bytes,
        (_, true) => columns * (rows * bytes).div_ceil(4) * 4,
    };
    let count = required_index(a.get("count"), "accessor.count")?;
    if check && count == 0 {
        return Err(invalid("accessor.count must be positive"));
    }
    let offset = optional_index(a.get("byteOffset"), "accessor.byteOffset", 0)?;
    let (base, stride) = match a.get("bufferView") {
        Some(view_id) => {
            let view = item(
                views,
                required_index(Some(view_id), "accessor.bufferView")?,
                "bufferView",
            )?;
            if optional_index(view.get("buffer"), "bufferView.buffer", 0)? != 0 {
                return Err(CompilerError::new(
                    "UNSUPPORTED_ACCESSOR",
                    "Only buffer zero is supported",
                ));
            }
            let stride = optional_index(
                view.get("byteStride"),
                "bufferView.byteStride",
                element_bytes,
            )?;
            let start = optional_index(view.get("byteOffset"), "bufferView.byteOffset", 0)?;
            if check
                && (stride < element_bytes
                    || stride % bytes != 0
                    || offset % bytes != 0
                    || start % bytes != 0)
            {
                return Err(invalid("Accessor stride or alignment is invalid"));
            }
            let base = match check {
                true => range(view, bin, offset, stride, count, element_bytes, "accessor")?,
                false => start
                    .checked_add(offset)
                    .ok_or_else(|| invalid("Accessor offset overflow"))?,
            };
            (Some(base), stride)
        }
        None if a.get("sparse").is_some() && offset == 0 => (None, element_bytes),
        None => return Err(invalid("accessor requires bufferView unless sparse")),
    };
    let sparse = match a.get("sparse") {
        Some(sparse) => Some(sparse_layout(
            sparse,
            views,
            bin,
            (count, bytes, element_bytes),
            check,
        )?),
        None => None,
    };
    Ok(Layout {
        component,
        bytes,
        shape: (columns, rows),
        count,
        normalized: a.get("normalized").and_then(Value::as_bool) == Some(true),
        base,
        stride,
        sparse,
    })
}
