use super::*;

/// `validated` holds the identifiers an upstream pass already validated — the
/// deduplicated set from `plan_buffers`. `validate` is a pure function with no
/// side effect of the same `g`, `bin` and `id`: a second validation could only
/// find the same verdict, and the error, if any, has already been raised. `None`
/// requests validation, as before.
pub(super) fn accessor<'a>(
    g: &'a Value,
    bin: &'a [u8],
    id: usize,
    validated: Option<&BTreeSet<usize>>,
) -> Result<Accessor<'a>> {
    if !validated.is_some_and(|ids| ids.contains(&id)) {
        accessor_validation::validate(g, bin, id)?;
    }
    let accessors = values(g, "accessors")?;
    let views = values(g, "bufferViews")?;
    let a = item(accessors, id, "accessor")?;
    let component = required_index(a.get("componentType"), "accessor.componentType")?;
    let normalized = a.get("normalized").and_then(Value::as_bool) == Some(true);
    if normalized && component == 5126 {
        return Err(invalid("FLOAT accessor cannot be normalized"));
    }
    let bytes = match component {
        5120 | 5121 => 1,
        5122 | 5123 => 2,
        5125 | 5126 => 4,
        _ => {
            return Err(CompilerError::new(
                "UNSUPPORTED_COMPONENT",
                component.to_string(),
            ))
        }
    };
    let width = match a.get("type").and_then(Value::as_str) {
        Some("SCALAR") => 1,
        Some("VEC2") => 2,
        Some("VEC3") => 3,
        Some("VEC4") => 4,
        _ => {
            return Err(CompilerError::new(
                "UNSUPPORTED_ACCESSOR_TYPE",
                "Unsupported or missing accessor type",
            ))
        }
    };
    let count = required_index(a.get("count"), "accessor.count")?;
    let (base, stride, has_buffer_view) = if let Some(bv) = a.get("bufferView") {
        let view_id = required_index(Some(bv), "accessor.bufferView")?;
        let v = item(views, view_id, "bufferView")?;
        if optional_index(v.get("buffer"), "bufferView.buffer", 0)? != 0 {
            return Err(CompilerError::new(
                "UNSUPPORTED_ACCESSOR",
                "Only buffer zero is supported",
            ));
        }
        let base = optional_index(v.get("byteOffset"), "bufferView.byteOffset", 0)?
            .checked_add(optional_index(
                a.get("byteOffset"),
                "accessor.byteOffset",
                0,
            )?)
            .ok_or_else(|| invalid("Accessor offset overflow"))?;
        let stride = optional_index(v.get("byteStride"), "bufferView.byteStride", width * bytes)?;
        if stride < width * bytes {
            return Err(invalid("Accessor stride is smaller than one element"));
        }
        (base, stride, true)
    } else {
        if a.get("sparse").is_none() {
            return Err(invalid("Accessor requires bufferView unless sparse"));
        }
        (0, width * bytes, false)
    };
    let sparse = if let Some(sparse_val) = a.get("sparse") {
        let scount = required_index(sparse_val.get("count"), "sparse.count")?;
        let ind_obj = sparse_val
            .get("indices")
            .ok_or_else(|| invalid("sparse.indices is required"))?;
        let ind_view_id = required_index(ind_obj.get("bufferView"), "sparse.indices.bufferView")?;
        let ind_view = item(views, ind_view_id, "bufferView")?;
        let ind_comp =
            required_index(ind_obj.get("componentType"), "sparse.indices.componentType")?;
        let ind_off = optional_index(
            ind_view.get("byteOffset"),
            "sparse.indices.view.byteOffset",
            0,
        )?
        .checked_add(optional_index(
            ind_obj.get("byteOffset"),
            "sparse.indices.byteOffset",
            0,
        )?)
        .ok_or_else(|| invalid("Sparse indices offset overflow"))?;
        let val_obj = sparse_val
            .get("values")
            .ok_or_else(|| invalid("sparse.values is required"))?;
        let val_view_id = required_index(val_obj.get("bufferView"), "sparse.values.bufferView")?;
        let val_view = item(views, val_view_id, "bufferView")?;
        let val_off = optional_index(
            val_view.get("byteOffset"),
            "sparse.values.view.byteOffset",
            0,
        )?
        .checked_add(optional_index(
            val_obj.get("byteOffset"),
            "sparse.values.byteOffset",
            0,
        )?)
        .ok_or_else(|| invalid("Sparse values offset overflow"))?;
        Some(SparseAccessor {
            count: scount,
            indices_bin: bin,
            indices_offset: ind_off,
            indices_component: ind_comp,
            values_bin: bin,
            values_offset: val_off,
        })
    } else {
        None
    };
    Ok(Accessor {
        bin,
        base,
        stride,
        count,
        component,
        bytes,
        width,
        normalized,
        has_buffer_view,
        sparse,
    })
}
