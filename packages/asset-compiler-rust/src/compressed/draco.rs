use super::*;
use draco_core::{DecodeLimits, DecoderBuffer, FaceIndex, Mesh, MeshDecoder};
mod attributes;
mod layout;

pub(super) fn expand(g: &mut Value, binary: Binary, budget: &Budget<'_>) -> Result<Binary> {
    let mut jobs = Vec::new();
    for (mesh, m) in values(g, "meshes")?.iter().enumerate() {
        for (primitive, p) in values(m, "primitives")?.iter().enumerate() {
            if p.get("extensions").and_then(|e| e.get(DRACO)).is_some() {
                jobs.push((mesh, primitive));
            }
        }
    }
    if jobs.is_empty() {
        return Ok(binary);
    }
    budget.admit(product(binary.bytes().len(), 2)?)?;
    let mut out = match binary {
        Binary::Owned(v) => v,
        Binary::Mapped(v) => {
            let mut out = reserve(v.len())?;
            out.extend_from_slice(&v);
            out
        }
    };
    for (mi, pi) in jobs {
        let primitive = g["meshes"][mi]["primitives"][pi].clone();
        let ext = &primitive["extensions"][DRACO];
        let mode = optional_index(primitive.get("mode"), "primitive.mode", 4)?;
        if !matches!(mode, 4 | 5) {
            return Err(invalid(
                "Draco requires triangle or triangle strip primitives",
            ));
        }
        let view_id = required_index(ext.get("bufferView"), "draco.bufferView")?;
        let view = item(values(g, "bufferViews")?, view_id, "draco.bufferView")?;
        let start = optional_index(view.get("byteOffset"), "bufferView.byteOffset", 0)?;
        let end = add(
            start,
            required_index(view.get("byteLength"), "bufferView.byteLength")?,
        )?;
        let source = out
            .get(start..end)
            .ok_or_else(|| invalid("Draco source exceeds buffer"))?;
        budget.admit(out.len())?;
        let available = budget.limit - out.len();
        // Reserve headroom for topology and materialized accessors. These are
        // admission estimates, not an exact bound on the codec allocator.
        // The codec independently enforces the configured count/attribute ceilings.
        let limits = DecodeLimits::default()
            .with_max_points((available / 256) as u64)
            .with_max_faces((available / 256) as u64)
            .with_max_decoded_bytes((available / 4) as u64);
        let mut decoded = Mesh::new();
        MeshDecoder::new()
            .decode(
                &mut DecoderBuffer::new(source).with_limits(limits),
                &mut decoded,
            )
            .map_err(|e| {
                let code = if e.kind() == draco_core::ErrorKind::LimitExceeded {
                    "RAM_ADMISSION_BUDGET_EXCEEDED"
                } else {
                    "INVALID_SOURCE"
                };
                CompilerError::new(code, format!("Draco decoding failed: {e}"))
            })?;
        budget.admit(out.len())?;
        layout::validate(g, &primitive, &decoded, mode)?;
        let mapping = ext
            .get("attributes")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("Draco attributes are required"))?;
        if mapping.is_empty() {
            return Err(invalid("Draco attributes are empty"));
        }
        let mut attributes = primitive["attributes"].clone();
        for (semantic, unique_id) in mapping {
            let original = required_index(attributes.get(semantic), "draco attribute accessor")?;
            let mut accessor = item(values(g, "accessors")?, original, "accessor")?.clone();
            let unique_id = u32::try_from(required_index(Some(unique_id), "draco attribute id")?)
                .map_err(|_| invalid("Draco attribute id overflow"))?;
            let bytes = attributes::decode(&decoded, unique_id, &accessor, budget, out.len())?;
            // Draco owns these values; fallback byte offsets and sparse storage do not.
            accessor
                .as_object_mut()
                .ok_or_else(|| invalid("Invalid Draco accessor"))?
                .remove("sparse");
            accessor["count"] = json!(decoded.num_points());
            let id = append(g, &mut out, accessor, &bytes, budget)?;
            attributes[semantic] = json!(id);
        }
        let count = product(decoded.num_faces(), 3)?;
        let length = product(count, 4)?;
        budget.admit(add(out.len(), product(length, 2)?)?)?;
        let mut indices = reserve::<u8>(length)?;
        for face in 0..decoded.num_faces() {
            for point in decoded.face(FaceIndex(face as u32)) {
                if point.0 as usize >= decoded.num_points() {
                    return Err(invalid("Draco index exceeds point count"));
                }
                indices.extend_from_slice(&point.0.to_le_bytes());
            }
        }
        let id = append(
            g,
            &mut out,
            json!({"componentType":5125,"type":"SCALAR","count":count}),
            &indices,
            budget,
        )?;
        let primitive = &mut g["meshes"][mi]["primitives"][pi];
        primitive["attributes"] = attributes;
        primitive["indices"] = json!(id);
        primitive["mode"] = json!(4);
        primitive["extensions"]
            .as_object_mut()
            .unwrap()
            .remove(DRACO);
    }
    g["buffers"][0]["byteLength"] = json!(out.len());
    Ok(Binary::Owned(out))
}
fn append(
    g: &mut Value,
    out: &mut Vec<u8>,
    mut accessor: Value,
    bytes: &[u8],
    budget: &Budget<'_>,
) -> Result<usize> {
    let start = add(out.len(), crate::shared_math::pad_to_4(out.len()))?;
    let end = add(start, bytes.len())?;
    budget.admit(add(end, bytes.len())?)?;
    out.try_reserve_exact(end - out.len()).map_err(|_| {
        CompilerError::new(
            "RAM_ADMISSION_BUDGET_EXCEEDED",
            "Draco accessor allocation failed",
        )
    })?;
    out.resize(start, 0);
    out.extend_from_slice(bytes);
    let views = g["bufferViews"]
        .as_array_mut()
        .ok_or_else(|| invalid("bufferViews array is required"))?;
    accessor["bufferView"] = json!(views.len());
    accessor["byteOffset"] = json!(0);
    views.push(json!({"buffer":0,"byteOffset":start,"byteLength":bytes.len()}));
    let accessors = g["accessors"]
        .as_array_mut()
        .ok_or_else(|| invalid("accessors array is required"))?;
    let id = accessors.len();
    accessors.push(accessor);
    Ok(id)
}
