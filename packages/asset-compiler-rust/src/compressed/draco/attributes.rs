use super::*;
use draco_core::{DataType, PointIndex};

pub(super) fn decode(
    mesh: &Mesh,
    id: u32,
    accessor: &Value,
    budget: &Budget<'_>,
    retained: usize,
) -> Result<Vec<u8>> {
    let attribute = mesh
        .attribute_by_unique_id(id)
        .ok_or_else(|| invalid("Draco attribute id is absent"))?;
    let (component, scalar) = match attribute.data_type() {
        DataType::Int8 => (5120, 1),
        DataType::Uint8 => (5121, 1),
        DataType::Int16 => (5122, 2),
        DataType::Uint16 => (5123, 2),
        DataType::Uint32 => (5125, 4),
        DataType::Float32 => (5126, 4),
        _ => {
            return Err(invalid(
                "Draco attribute type cannot be represented in glTF",
            ));
        }
    };
    let width = match accessor.get("type").and_then(Value::as_str) {
        Some("SCALAR") => 1,
        Some("VEC2") => 2,
        Some("VEC3") => 3,
        Some("VEC4") => 4,
        _ => return Err(invalid("Invalid Draco accessor type")),
    };
    if required_index(accessor.get("componentType"), "accessor.componentType")? != component
        || width != attribute.num_components() as usize
    {
        return Err(invalid("Draco attribute differs from accessor layout"));
    }
    let record = product(width, scalar)?;
    let length = product(mesh.num_points(), record)?;
    budget.admit(add(retained, product(length, 2)?)?)?;
    let stride = usize::try_from(attribute.byte_stride())
        .map_err(|_| invalid("Invalid Draco attribute stride"))?;
    if stride < record {
        return Err(invalid("Invalid Draco attribute stride"));
    }
    let source = attribute.buffer().data();
    let mut out = reserve(length)?;
    for point in 0..mesh.num_points() {
        if point % 4096 == 0 {
            budget.admit(retained)?;
        }
        let entry = attribute.mapped_index(PointIndex(point as u32)).0 as usize;
        let start = product(entry, stride)?;
        let end = add(start, record)?;
        out.extend_from_slice(
            source
                .get(start..end)
                .ok_or_else(|| invalid("Draco attribute mapping is out of bounds"))?,
        );
    }
    Ok(out)
}
