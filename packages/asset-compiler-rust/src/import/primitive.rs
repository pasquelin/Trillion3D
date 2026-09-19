//! Emission of a glTF primitive from deduplicated vertices, shared by scene drivers
//! that build their geometry themselves.
//!
//! Format-independent: parallel vertex arrays and an index sequence
//! become binary views, accessors, and primitive citing them. What
//! depends on format — how to obtain arrays — stays in driver.
use super::*;

/// Primitive vertices, deduplicated by driver. `positions` mandatory; empty array
/// means attribute does not exist on primitive and is not written.
#[derive(Default)]
pub(crate) struct Vertices {
    pub(crate) positions: Vec<f32>,
    pub(crate) normals: Vec<f32>,
    pub(crate) uvs: Vec<f32>,
    pub(crate) colors: Vec<f32>,
    pub(crate) indices: Vec<u32>,
}

impl Vertices {
    /// Vertex count, deduced from positions.
    pub(crate) fn count(&self) -> usize {
        self.positions.len() / 3
    }
}

/// Writes vertices into `bin`, pushes accessors, returns citing glTF primitive.
/// `material` is material index, `None` when primitive has no material.
///
/// `POSITION` bounds computed here from written positions as glTF requires: position
/// accessor without `min`/`max` cannot be read by scene-culling engine.
pub(crate) fn primitive(
    vertices: &Vertices,
    bin: &mut Bin,
    accessors: &mut Vec<Value>,
    material: Option<usize>,
) -> Value {
    let count = vertices.count();
    let (min, max) = bounds(&vertices.positions);
    let view = bin.view(&f32_bytes(&vertices.positions), Some(34962));
    accessors.push(
        json!({"bufferView":view,"componentType":5126,"count":count,"type":"VEC3","min":min,"max":max}),
    );
    let mut attributes = json!({ "POSITION": accessors.len() - 1 });
    for (name, values, kind) in [
        ("NORMAL", &vertices.normals, "VEC3"),
        ("TEXCOORD_0", &vertices.uvs, "VEC2"),
        ("COLOR_0", &vertices.colors, "VEC4"),
    ] {
        if values.is_empty() {
            continue;
        }
        let view = bin.view(&f32_bytes(values), Some(34962));
        accessors.push(json!({"bufferView":view,"componentType":5126,"count":count,"type":kind}));
        attributes[name] = json!(accessors.len() - 1);
    }
    let (bytes, component) = index_bytes(&vertices.indices, count);
    let view = bin.view(&bytes, Some(34963));
    accessors.push(
        json!({"bufferView":view,"componentType":component,"count":vertices.indices.len(),"type":"SCALAR"}),
    );
    let mut primitive = json!({"attributes":attributes,"indices":accessors.len()-1,"mode":4});
    if let Some(material) = material {
        primitive["material"] = json!(material);
    }
    primitive
}

/// Position array bounds, per axis.
fn bounds(positions: &[f32]) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::MAX; 3];
    let mut max = [f32::MIN; 3];
    for vertex in positions.as_chunks::<3>().0 {
        crate::shared_math::extend_aabb_f32(&mut min, &mut max, *vertex);
    }
    (min, max)
}
