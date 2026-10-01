use super::*;

/// Bytes an accessor will occupy once decoded into a dense array: `count` elements
/// of `components` four-byte values. An accessor without a `bufferView`, or whose
/// sparse carries only a few values, expands the same way: that expansion is what
/// an allocation will request, never the stored bytes, and it alone can overflow
/// an integer.
pub(super) fn dense_bytes(acc: &Value) -> Result<usize> {
    let components = match acc.get("type").and_then(Value::as_str) {
        Some("SCALAR") => 1,
        Some("VEC2") => 2,
        Some("VEC3") => 3,
        Some("VEC4") | Some("MAT2") => 4,
        Some("MAT3") => 9,
        Some("MAT4") => 16,
        _ => return Err(invalid("Unsupported accessor type")),
    };
    required_index(acc.get("count"), "accessor.count")?
        .checked_mul(components)
        .and_then(|values| values.checked_mul(4))
        .ok_or_else(|| invalid("Working set overflow"))
}

/// The accessors a primitive reads: its indices, every attribute and every morph target. A
/// primitive without `POSITION` is refused.
pub(super) fn primitive_accessors(p: &Value, accessors: &mut BTreeSet<usize>) -> Result<()> {
    if let Some(indices) = p.get("indices") {
        accessors.insert(required_index(Some(indices), "primitive.indices")?);
    }
    let attributes = p
        .get("attributes")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("primitive.attributes is required"))?;
    if !attributes.contains_key("POSITION") {
        return Err(invalid("primitive.attributes.POSITION is required"));
    }
    for a in attributes.values() {
        accessors.insert(required_index(Some(a), "primitive attribute")?);
    }
    for target in p
        .get("targets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for a in target.as_object().into_iter().flat_map(|t| t.values()) {
            accessors.insert(required_index(Some(a), "primitive target attribute")?);
        }
    }
    Ok(())
}
