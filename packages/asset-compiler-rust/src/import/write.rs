//! Writing intermediate scene to cache folder: `model.gltf`, `model.bin`, and
//! `manifest.json`. Shared by ufbx conversion and scene drivers filling own
//! glTF tables; each provides only its roots and manifest source info.
use super::*;

/// glTF tables of intermediate scene, borrowed while writing.
pub(crate) struct Tables<'a> {
    pub(crate) nodes: &'a [Value],
    pub(crate) meshes: &'a [Value],
    pub(crate) materials: &'a [Value],
    pub(crate) accessors: &'a [Value],
    pub(crate) images: &'a [Value],
    pub(crate) samplers: &'a [Value],
    pub(crate) textures: &'a [Value],
    pub(crate) bin: &'a Bin,
}

impl Tables<'_> {
    /// glTF document, named by producing driver, whose scene starts at `roots`.
    pub(crate) fn document(&self, plugin: &dyn ScenePlugin, roots: &[usize]) -> Value {
        let generator = format!(
            "trillion3d-compiler {} ({})",
            crate::COMPILER_VERSION,
            plugin.version()
        );
        let mut gltf = json!({
            "asset":{"version":"2.0","generator":generator},
            "scene":0,"scenes":[{"nodes":roots}],
            "nodes":self.nodes,"meshes":self.meshes,"materials":self.materials,
            "accessors":self.accessors,"bufferViews":self.bin.views,
            "buffers":[{"uri":"model.bin","byteLength":self.bin.bytes.len()}],
        });
        if !self.images.is_empty() {
            gltf["images"] = json!(self.images);
            gltf["samplers"] = json!(self.samplers);
            gltf["textures"] = json!(self.textures);
        }
        gltf
    }
}

/// Writes binary, serialized document, and manifest to `directory`. `stats` gives
/// mesh-bearing nodes and triangles; `source` yields manifest `source` field,
/// evaluated once scene files written.
pub(crate) fn write_scene(
    directory: &Path,
    gltf: &[u8],
    bin: &Bin,
    (mesh_nodes, triangles): (usize, usize),
    report: &Report,
    source: impl FnOnce() -> Value,
) -> Result<()> {
    fs::create_dir_all(directory)?;
    atomic(&directory.join("model.bin"), &bin.bytes)?;
    atomic(&directory.join("model.gltf"), gltf)?;
    let mut manifest = runtime_manifest(
        "model.gltf",
        &hash(gltf),
        &[("model.bin".to_string(), hash(&bin.bytes))],
        mesh_nodes,
        triangles,
    );
    manifest["runtime"]["bytes"] = json!(gltf.len());
    manifest["source"] = source();
    manifest["unsupported"] = json!(report.unsupported);
    manifest["notes"] = json!(report.notes);
    atomic(
        &directory.join("manifest.json"),
        &serde_json::to_vec_pretty(&manifest)?,
    )
}
