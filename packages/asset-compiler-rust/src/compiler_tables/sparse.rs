//! The sparse substitution an accessor of a published document declares, laid out for the runtime
//! that writes the substituted elements into a copy of the base run, as the host loader does.
use super::*;

/// The sparse substitution of an accessor as the published document declares it: how many
/// elements it replaces, where their ranks are and where their values are. `null` for none.
pub(super) fn sparse(declared: Option<&Value>, views: usize) -> Result<Value> {
    let Some(declared) = declared else {
        return Ok(Value::Null);
    };
    let part = |name: &str| -> Result<(usize, usize)> {
        let view = required_index(
            declared.pointer(&format!("/{name}/bufferView")),
            "sparse view",
        )?;
        if view >= views {
            return Err(invalid("sparse bufferView index is out of bounds"));
        }
        let offset = optional_index(
            declared.pointer(&format!("/{name}/byteOffset")),
            "sparse offset",
            0,
        )?;
        Ok((view, offset))
    };
    let ((index_view, index_offset), (value_view, value_offset)) =
        (part("indices")?, part("values")?);
    let component = declared
        .pointer("/indices/componentType")
        .and_then(Value::as_u64);
    if !component.is_some_and(|c| matches!(c, 5121 | 5123 | 5125)) {
        return Err(invalid("sparse indices componentType is not readable"));
    }
    Ok(json!({
        "count": required_index(declared.get("count"), "sparse.count")?,
        "indices": {"view": index_view, "offset": index_offset, "componentType": component},
        "values": {"view": value_view, "offset": value_offset},
    }))
}
