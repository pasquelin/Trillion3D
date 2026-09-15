//! Lecture de la scène intermédiaire : le glTF 2.0 et son conteneur GLB, que tout pilote de scène
//! produit et que le compilateur est seul à consommer. Le choix du pilote, lui, est dans `plugins`.
use super::*;

pub(super) fn is_glb(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0] == b'g' && bytes[1] == b'l' && bytes[2] == b'T' && bytes[3] == b'F'
}
pub(super) fn parse_glb(bytes: &[u8]) -> Result<(Value, Vec<u8>)> {
    if bytes.len() < 12 {
        return Err(invalid("GLB too short"));
    }
    let magic = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
    if magic != 0x4654_6C67 {
        return Err(invalid("Not a GLB"));
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    if version != 2 {
        return Err(CompilerError::new(
            "UNSUPPORTED_FORMAT",
            "Only GLB version 2 is supported",
        ));
    }
    let length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    if length != bytes.len() {
        return Err(invalid("GLB length mismatch"));
    }
    let mut offset = 12;
    let mut json = None;
    let mut bin = None;
    while offset + 8 <= bytes.len() {
        let chunk_len = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let chunk_type = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap());
        offset += 8;
        let end = offset
            .checked_add(chunk_len)
            .ok_or_else(|| invalid("GLB chunk overflow"))?;
        if end > bytes.len() {
            return Err(invalid("GLB chunk exceeds file"));
        }
        let data = &bytes[offset..end];
        match chunk_type {
            0x4E4F_534A => json = Some(serde_json::from_slice::<Value>(data)?),
            0x004E_4942 => bin = Some(data.to_vec()),
            _ => {}
        }
        offset = end;
    }
    Ok((
        json.ok_or_else(|| invalid("GLB JSON chunk is required"))?,
        bin.unwrap_or_default(),
    ))
}
pub(super) fn primitive_triangles(g: &Value, p: &Value) -> Result<usize> {
    let attributes = p
        .get("attributes")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("primitive.attributes is required"))?;
    if !attributes.contains_key("POSITION") {
        return Err(invalid("primitive.attributes.POSITION is required"));
    }
    let accessors = values(g, "accessors")?;
    if let Some(index_v) = p.get("indices") {
        let id = required_index(Some(index_v), "primitive.indices")?;
        let count = required_index(
            item(accessors, id, "accessor")?.get("count"),
            "accessor.count",
        )?;
        if count == 0 || count % 3 != 0 {
            return Err(CompilerError::new(
                "INVALID_TRIANGLES",
                "Index count must be a positive multiple of three",
            ));
        }
        Ok(count / 3)
    } else {
        let id = required_index(attributes.get("POSITION"), "primitive.attributes.POSITION")?;
        let count = required_index(
            item(accessors, id, "accessor")?.get("count"),
            "accessor.count",
        )?;
        if count == 0 || count % 3 != 0 {
            return Err(invalid(
                "Unindexed POSITION count must be a positive multiple of three",
            ));
        }
        Ok(count / 3)
    }
}
pub(super) fn node_triangles(g: &Value, node: &Value) -> Result<usize> {
    let mesh_id = required_index(node.get("mesh"), "node.mesh")?;
    let mesh = item(values(g, "meshes")?, mesh_id, "mesh")?;
    let mut triangles = 0;
    for p in values(mesh, "primitives")? {
        triangles += primitive_triangles(g, p)?;
    }
    Ok(triangles)
}
pub(super) fn source_stats(g: &Value) -> Result<(usize, usize)> {
    let mut mesh_nodes = 0;
    let mut triangles = 0;
    for n in values(g, "nodes")? {
        if n.get("mesh").is_some() {
            mesh_nodes += 1;
            triangles += node_triangles(g, n)?;
        }
    }
    Ok((mesh_nodes, triangles))
}
