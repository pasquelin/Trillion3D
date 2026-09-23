//! The geometry layout of one published document: where each vertex attribute and each index list
//! of every primitive sits in the binary the document is published with, how it is typed, the box
//! its positions declare, the surface each primitive wears, and where each image comes from.
//!
//! The runtime views the binary through these numbers and nothing else: it neither parses the
//! document nor decodes anything the compiler has not already laid out. The compiler writes one
//! buffer per document (`source.bin`, `scene.bin`), so every view offset is an offset into it.
use super::*;

/// The element types a reader knows the width of.
const TYPES: [&str; 7] = ["SCALAR", "VEC2", "VEC3", "VEC4", "MAT2", "MAT3", "MAT4"];
/// The component types a vertex attribute or an index list may use.
const COMPONENTS: [u64; 6] = [5120, 5121, 5122, 5123, 5125, 5126];

fn views(g: &Value) -> Result<Vec<Value>> {
    let Some(views) = g.get("bufferViews").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    views
        .iter()
        .map(|view| {
            if optional_index(view.get("buffer"), "bufferView.buffer", 0)? != 0 {
                return Err(invalid("a published document carries one buffer"));
            }
            Ok(json!({
                "offset": optional_index(view.get("byteOffset"), "bufferView.byteOffset", 0)?,
                "length": required_index(view.get("byteLength"), "bufferView.byteLength")?,
                "stride": match view.get("byteStride") {
                    Some(stride) => Some(required_index(Some(stride), "bufferView.byteStride")?),
                    None => None,
                },
            }))
        })
        .collect()
}

fn accessors(g: &Value, views: usize) -> Result<Vec<Value>> {
    let Some(accessors) = g.get("accessors").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    accessors
        .iter()
        .map(|accessor| {
            // The published document decodes sparse accessors into plain views; one still sparse
            // here would be a compiler bug, and reading it as dense would draw the wrong values.
            if accessor.get("sparse").is_some() {
                return Err(invalid("a published accessor is sparse"));
            }
            let view = match accessor.get("bufferView") {
                Some(view) => Some(required_index(Some(view), "accessor.bufferView")?),
                None => None,
            };
            if view.is_some_and(|view| view >= views) {
                return Err(invalid("accessor.bufferView index is out of bounds"));
            }
            let kind = accessor.get("type").and_then(Value::as_str).unwrap_or("");
            let component = accessor.get("componentType").and_then(Value::as_u64);
            if !TYPES.contains(&kind) || !component.is_some_and(|c| COMPONENTS.contains(&c)) {
                return Err(invalid("accessor type or componentType is not readable"));
            }
            Ok(json!({
                "view": view,
                "offset": optional_index(accessor.get("byteOffset"), "accessor.byteOffset", 0)?,
                "componentType": component,
                "normalized": accessor.get("normalized").and_then(Value::as_bool) == Some(true),
                "count": required_index(accessor.get("count"), "accessor.count")?,
                "type": kind,
                "min": accessor.get("min").cloned().unwrap_or(Value::Null),
                "max": accessor.get("max").cloned().unwrap_or(Value::Null),
            }))
        })
        .collect()
}

/// One primitive: its attributes by glTF semantic, its index list and the surface rank it wears.
fn primitive(g: &Value, p: &Value, accessors: usize, surfaces: &mut Materials) -> Result<Value> {
    if optional_index(p.get("mode"), "primitive.mode", 4)? != 4 {
        return Err(CompilerError::new(
            "UNSUPPORTED_PRIMITIVE",
            "Only static triangles are supported",
        ));
    }
    let mut attributes = serde_json::Map::new();
    for (semantic, id) in p
        .get("attributes")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("primitive.attributes is required"))?
    {
        let id = required_index(Some(id), "primitive.attributes")?;
        if id >= accessors {
            return Err(invalid("primitive attribute index is out of bounds"));
        }
        attributes.insert(semantic.clone(), json!(id));
    }
    let indices = match p.get("indices") {
        Some(value) => Some(required_index(Some(value), "primitive.indices")?),
        None => None,
    };
    if indices.is_some_and(|id| id >= accessors) {
        return Err(invalid("primitive.indices index is out of bounds"));
    }
    Ok(json!({"attributes":attributes,"indices":indices,"material":surfaces.rank(g, p)?}))
}

fn images(g: &Value, views: usize) -> Result<Vec<Value>> {
    let Some(images) = g.get("images").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    images
        .iter()
        .map(|image| {
            let view = match image.get("bufferView") {
                Some(view) => Some(required_index(Some(view), "image.bufferView")?),
                None => None,
            };
            if view.is_some_and(|view| view >= views) {
                return Err(invalid("image.bufferView index is out of bounds"));
            }
            Ok(json!({
                "name": image.get("name").and_then(Value::as_str).unwrap_or(""),
                "uri": image.get("uri").cloned().unwrap_or(Value::Null),
                "view": view,
                "mimeType": image.get("mimeType").cloned().unwrap_or(Value::Null),
            }))
        })
        .collect()
}

/// The layout of one published document, the binary it is read from named beside it.
pub(super) fn document_table(g: &Value, buffer: &str, surfaces: &mut Materials) -> Result<Value> {
    let views = views(g)?;
    let accessors = accessors(g, views.len())?;
    let mut meshes = Vec::new();
    for mesh in g
        .get("meshes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        let mut parts = Vec::new();
        for p in values(mesh, "primitives")? {
            parts.push(primitive(g, p, accessors.len(), surfaces)?);
        }
        meshes.push(json!({
            "name": mesh.get("name").and_then(Value::as_str).unwrap_or(""),
            "primitives": parts,
        }));
    }
    let images = images(g, views.len())?;
    Ok(json!({"buffer":buffer,"views":views,"accessors":accessors,"meshes":meshes,"images":images}))
}
