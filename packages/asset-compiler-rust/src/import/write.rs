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

/// The tables a converter holds in fields of these names, borrowed as `Tables`.
macro_rules! borrowed_tables {
    ($converter:expr) => {
        $crate::import::Tables {
            nodes: &$converter.nodes,
            meshes: &$converter.meshes,
            materials: &$converter.materials,
            accessors: &$converter.accessors,
            images: &$converter.images,
            samplers: &$converter.samplers,
            textures: &$converter.textures,
            bin: &$converter.bin,
        }
    };
}
pub(crate) use borrowed_tables;

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

/// The manifest `source` of a converted scene, what every driver reports: its plugin, the file, the
/// counts of what it read, how many meshes and materials it made, and the import's time. A driver
/// adds the fields only it has, as `extra`.
pub(crate) fn scene_source(
    plugin: &dyn ScenePlugin,
    path: &Path,
    started: std::time::Instant,
    counts: &std::collections::BTreeMap<&'static str, usize>,
    (meshes, materials): (usize, usize),
    extra: Value,
) -> Value {
    let mut source = json!({
        "plugin": crate::plugins::provenance(plugin), "path": path.to_string_lossy(),
        "counts": counts, "meshes": meshes, "materials": materials,
        "importMs": crate::shared_math::elapsed_ms(started),
    });
    if let (Some(source), Value::Object(extra)) = (source.as_object_mut(), extra) {
        source.extend(extra);
    }
    source
}

/// A converted scene that carries its images, textures and lights, ready to be written.
pub(crate) struct Converted<'a> {
    pub(crate) tables: Tables<'a>,
    pub(crate) roots: &'a [usize],
    pub(crate) lights: &'a [Value],
    pub(crate) report: &'a Report,
    pub(crate) counts: &'a std::collections::BTreeMap<&'static str, usize>,
    /// The files read, as the manifest publishes them.
    pub(crate) files: Value,
    /// Mesh-bearing nodes and the instanced triangles they draw.
    pub(crate) stats: (usize, usize),
}

impl Converted<'_> {
    /// Writes the scene to `directory` through `write_scene`, its lights attached, and returns
    /// `directory`: what every driver that fills the tables of images and lights ends with.
    pub(crate) fn write(
        &self,
        plugin: &dyn ScenePlugin,
        directory: &Path,
        source: &Path,
        started: std::time::Instant,
    ) -> Result<PathBuf> {
        let mut document = self.tables.document(plugin, self.roots);
        attach_lights(&mut document, self.lights);
        let gltf = serde_json::to_vec(&document)?;
        write_scene(
            directory,
            &gltf,
            self.tables.bin,
            self.stats,
            self.report,
            || {
                scene_source(
                    plugin,
                    source,
                    started,
                    self.counts,
                    (self.tables.meshes.len(), self.tables.materials.len()),
                    json!({"files": self.files, "images": self.tables.images.len()}),
                )
            },
        )?;
        Ok(directory.to_path_buf())
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
