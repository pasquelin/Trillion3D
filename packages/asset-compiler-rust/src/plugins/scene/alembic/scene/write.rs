//! The digest that makes a repeated mesh one instance.
//!
//! Two objects whose converted bytes are the same are the same mesh posed twice: that is
//! instancing, read from the content and not from a field the format does not always write.
use super::super::mesh::{FaceSet, Part};
use crate::hash;
use crate::plugins::scene::convert::f32_bytes;

/// The digest of a mesh's content: its attribute bytes and the materials it names. Two objects
/// that share it are the same mesh posed twice, whatever their names.
pub(super) fn digest(parts: &[Part], facesets: &[FaceSet]) -> String {
    let mut material = Vec::new();
    for part in parts {
        let name = part
            .faceset
            .and_then(|rank| facesets.get(rank))
            .map_or("", |faceset| faceset.name.as_str());
        material.extend_from_slice(name.as_bytes());
        let vertices = &part.vertices;
        material.extend_from_slice(&f32_bytes(&vertices.positions));
        material.extend_from_slice(&f32_bytes(&vertices.normals));
        material.extend_from_slice(&f32_bytes(&vertices.uvs));
        material.extend(
            vertices
                .indices
                .iter()
                .flat_map(|index| index.to_le_bytes()),
        );
    }
    hash(&material)
}
