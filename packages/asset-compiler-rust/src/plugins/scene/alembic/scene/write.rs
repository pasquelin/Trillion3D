//! L écriture de la scène intermédiaire dans le cache, et l empreinte qui fait d un maillage répété
//!
//! Deux objets dont les octets convertis sont les mêmes sont le même maillage posé deux fois : c est
//! l instanciation, lue dans le contenu et non dans un champ que le format n écrit pas toujours.
use super::super::mesh::{FaceSet, Part};
use super::super::*;
use super::Scene;
use crate::hash;
use crate::import::{f32_bytes, write_scene, Tables};

impl Scene {
    /// Écrit la scène dans `directory` et rend ce dossier.
    pub(in super::super) fn write(
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

/// L'empreinte du contenu d'un maillage : ses octets d'attributs et les matériaux qu'il nomme. Deux
/// objets qui la partagent sont le même maillage posé deux fois, quels que soient leurs noms.
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
