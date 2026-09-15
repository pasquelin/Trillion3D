//! L'écriture d'une scène intermédiaire dans son dossier de cache : `model.gltf`, `model.bin` et
//! `manifest.json`. Partagée par la conversion ufbx et par les pilotes de scène qui remplissent leurs
//! propres tables glTF ; chacun ne donne que ses racines et ce que son manifeste dit de la source.
use super::*;

/// Les tables glTF d'une scène intermédiaire, empruntées le temps de l'écrire.
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
    /// Le document glTF, nommé par le pilote qui l'a produit, dont la scène part de `roots`.
    pub(crate) fn document(&self, plugin: &dyn ScenePlugin, roots: &[usize]) -> Value {
        let generator = format!(
            "web-geometry-compiler {} ({})",
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

/// Écrit le binaire, le document déjà sérialisé et le manifeste dans `directory`. `stats` donne les
/// nœuds porteurs de maillage et leurs triangles ; `source` rend le champ `source` du manifeste,
/// évalué une fois les fichiers de la scène écrits.
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
