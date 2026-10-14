use super::*;
use crate::gltf_codes::{
    component_bytes, BYTE, FLOAT, SHORT, UNSIGNED_BYTE, UNSIGNED_INT, UNSIGNED_SHORT,
};
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
    let component = match attribute.data_type() {
        DataType::Int8 => BYTE,
        DataType::Uint8 => UNSIGNED_BYTE,
        DataType::Int16 => SHORT,
        DataType::Uint16 => UNSIGNED_SHORT,
        DataType::Uint32 => UNSIGNED_INT,
        DataType::Float32 => FLOAT,
        _ => {
            return Err(invalid(
                "Draco attribute type cannot be represented in glTF",
            ));
        }
    };
    let scalar = component_bytes(component)
        .ok_or_else(|| invalid("Draco attribute type cannot be represented in glTF"))?;
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
