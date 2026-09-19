//! Writing the intermediate scene into the cache, and the digest that makes a repeated mesh
//! one instance.
//!
//! Two objects whose converted bytes are the same are the same mesh posed twice: that is
//! instancing, read from the content and not from a field the format does not always write.
use super::super::mesh::{FaceSet, Part};
use super::super::*;
use super::Scene;
use crate::hash;
use crate::import::{f32_bytes, write_scene, Tables};
use crate::plugins::scene::SceneOutput;

impl SceneOutput for Scene {
    fn nodes(&self) -> &[Value] {
        &self.nodes
    }
    fn counts(&self) -> &BTreeMap<&'static str, usize> {
        &self.counts
    }
    fn key(&self) -> String {
        hash(self.key_material.as_bytes())
    }
    fn write(
        self,
        plugin: &dyn ScenePlugin,
        directory: &Path,
        source: &Path,
        started: std::time::Instant,
    ) -> Result<PathBuf> {
        let tables = Tables {
            nodes: &self.nodes,
            meshes: &self.meshes,
            materials: &self.materials,
            accessors: &self.accessors,
            images: &[],
            samplers: &[],
            textures: &[],
            bin: &self.bin,
        };
        let gltf = serde_json::to_vec(&tables.document(plugin, &self.roots))?;
        write_scene(
            directory,
            &gltf,
            &self.bin,
            self.instanced,
            &self.report,
            || {
                json!({
                    "plugin": crate::plugins::provenance(plugin), "path": source.to_string_lossy(),
                    "counts": self.counts, "meshes": self.meshes.len(),
                    "materials": self.materials.len(),
                    "importMs": started.elapsed().as_secs_f64() * 1000.0,
                })
            },
        )?;
        Ok(directory.to_path_buf())
    }
}

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
        material.extend_from_slice(&f32_bytes(&part.positions));
        material.extend_from_slice(&f32_bytes(&part.normals));
        material.extend_from_slice(&f32_bytes(&part.uvs));
        material.extend(part.indices.iter().flat_map(|index| index.to_le_bytes()));
    }
    hash(&material)
}
