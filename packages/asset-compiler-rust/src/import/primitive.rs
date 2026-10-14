//! Emission of a glTF primitive from deduplicated vertices, shared by scene drivers
//! that build their geometry themselves.
//!
//! Format-independent: parallel vertex arrays and an index sequence
//! become binary views, accessors, and primitive citing them. What
//! depends on format — how to obtain arrays — stays in driver.
use super::*;
use crate::gltf_codes::{ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, FLOAT, UNSIGNED_SHORT};
use trillion3d_math::aabb::aabb_of_f32;

/// Primitive vertices, deduplicated by driver. `positions` mandatory; empty array
/// means attribute does not exist on primitive and is not written.
#[derive(Default)]
pub(crate) struct Vertices {
    pub(crate) positions: Vec<f32>,
    pub(crate) normals: Vec<f32>,
    pub(crate) uvs: Vec<f32>,
    pub(crate) colors: Vec<f32>,
    /// All bones and weights a vertex, on a skinned mesh (`motion.rs`).
    pub(crate) joints: Vec<u16>,
    pub(crate) weights: Vec<f32>,
    /// Per morph target, its position offsets and its normal offsets (empty when it has none).
    pub(crate) targets: Vec<(Vec<f32>, Vec<f32>)>,
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
/// accessor without `min`/`max` cannot be read by scene-culling engine. Every caller writes a
/// primitive of at least one triangle, so the box is never the empty one.
pub(crate) fn primitive(
    vertices: &Vertices,
    bin: &mut Bin,
    accessors: &mut Vec<Value>,
    material: Option<usize>,
) -> Value {
    let count = vertices.count();
    let (min, max) = aabb_of_f32(vertices.positions.as_chunks::<3>().0.iter().copied());
    let view = bin.view(&f32_bytes(&vertices.positions), Some(ARRAY_BUFFER));
    accessors.push(
        json!({"bufferView":view,"componentType":FLOAT,"count":count,"type":"VEC3","min":min,"max":max}),
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
        let view = bin.view(&f32_bytes(values), Some(ARRAY_BUFFER));
        accessors.push(json!({"bufferView":view,"componentType":FLOAT,"count":count,"type":kind}));
        attributes[name] = json!(accessors.len() - 1);
    }
    if !vertices.joints.is_empty() {
        let width = vertices.joints.len() / count;
        for set in 0..width / 4 {
            let ranks = (0..count).flat_map(|v| v * width + set * 4..v * width + set * 4 + 4);
            let bytes: Vec<u8> = ranks
                .clone()
                .flat_map(|i| vertices.joints[i].to_le_bytes())
                .collect();
            let view = bin.view(&bytes, Some(ARRAY_BUFFER));
            accessors
                .push(json!({"bufferView":view,"componentType":UNSIGNED_SHORT,"count":count,"type":"VEC4"}));
            attributes[format!("JOINTS_{set}")] = json!(accessors.len() - 1);
            let weights: Vec<f32> = ranks.map(|i| vertices.weights[i]).collect();
            let view = bin.view(&f32_bytes(&weights), Some(ARRAY_BUFFER));
            accessors
                .push(json!({"bufferView":view,"componentType":FLOAT,"count":count,"type":"VEC4"}));
            attributes[format!("WEIGHTS_{set}")] = json!(accessors.len() - 1);
        }
    }
    let mut targets = Vec::new();
    for (offsets, normals) in &vertices.targets {
        let (min, max) = aabb_of_f32(offsets.as_chunks::<3>().0.iter().copied());
        let view = bin.view(&f32_bytes(offsets), Some(ARRAY_BUFFER));
        accessors.push(json!({"bufferView":view,"componentType":FLOAT,"count":count,"type":"VEC3","min":min,"max":max}));
        let mut target = json!({"POSITION": accessors.len() - 1});
        if !normals.is_empty() {
            let view = bin.view(&f32_bytes(normals), Some(ARRAY_BUFFER));
            accessors
                .push(json!({"bufferView":view,"componentType":FLOAT,"count":count,"type":"VEC3"}));
            target["NORMAL"] = json!(accessors.len() - 1);
        }
        targets.push(target);
    }
    let (bytes, component) = index_bytes(&vertices.indices, count);
    let view = bin.view(&bytes, Some(ELEMENT_ARRAY_BUFFER));
    accessors.push(
        json!({"bufferView":view,"componentType":component,"count":vertices.indices.len(),"type":"SCALAR"}),
    );
    let mut primitive = json!({"attributes":attributes,"indices":accessors.len()-1,"mode":4});
    if !targets.is_empty() {
        primitive["targets"] = json!(targets);
    }
    if let Some(material) = material {
        primitive["material"] = json!(material);
    }
    primitive
}
