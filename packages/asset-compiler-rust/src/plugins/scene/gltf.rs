//! Pilote glTF 2.0 et GLB, standard Khronos. Entrée directe : la scène intermédiaire du compilateur
//! est déjà un glTF, ce pilote ne convertit donc rien et ne touche jamais à la source.
use super::*;
use crate::CompilerError;

pub(super) static GLTF: Gltf = Gltf;
pub(super) struct Gltf;

impl Plugin for Gltf {
    fn name(&self) -> &'static str {
        "gltf"
    }
    /// Le glTF entre tel quel : cette version ne suit que les règles de routage, pas un décodeur.
    fn version(&self) -> &'static str {
        "gltf-2.0-direct-1"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["gltf", "glb"]
    }
}

impl ScenePlugin for Gltf {
    /// L'entête d'un conteneur GLB, pour un fichier que son nom ne désigne pas.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(b"glTF")
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        let [file] = request.inputs else {
            return Err(CompilerError::new(
                "SOURCE_FORMAT_AMBIGUOUS",
                format!(
                    "gltf: a source directory carries exactly one .gltf or .glb, found {}",
                    request.inputs.len()
                ),
            ));
        };
        let name = file
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| CompilerError::new("INVALID_SOURCE", "runtime file is required"))?;
        Ok(PreparedScene::InPlace(name.to_string()))
    }
}
