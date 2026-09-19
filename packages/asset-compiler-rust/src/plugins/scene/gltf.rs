//! glTF 2.0 and GLB driver, Khronos standard. Direct entry: the compiler's intermediate
//! scene is already a glTF, so this driver converts nothing and never touches the source.
use super::*;
use crate::CompilerError;

pub(super) static GLTF: Gltf = Gltf;
pub(super) struct Gltf;

impl Plugin for Gltf {
    fn name(&self) -> &'static str {
        "gltf"
    }
    /// The glTF enters as-is: this version only follows the routing rules, not a decoder.
    fn version(&self) -> &'static str {
        "gltf-2.0-direct-1"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["gltf", "glb"]
    }
}

impl ScenePlugin for Gltf {
    /// Header of a GLB container, for a file that its name does not designate.
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
