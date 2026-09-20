//! Intermediate scene being built, and write to cache, shared by scene drivers
//! filling their own glTF tables.
//!
//! Driver fills same tables as glTF 2.0 — nodes, meshes, materials, accessors,
//! images — then publishes `model.gltf`, `model.bin`, and `manifest.json`, the only thing
//! compiler reads. Format-independent: only population depends on format.
//! Nothing written alongside source.
use super::*;
use crate::plugins::scene::SceneOutput;
mod media;
pub(crate) use media::readable;

/// Default sampler filtering unless specified: linear magnification,
/// linear between mipmaps on minification.
const DEFAULT_FILTER: [u32; 2] = [9729, 9987];

/// glTF tables being written. Constructed via `new`: key carries driver.
#[derive(Default)]
pub(crate) struct SceneTables {
    pub(crate) nodes: Vec<Value>,
    pub(crate) meshes: Vec<Value>,
    /// Triangle count of each mesh, by rank in `meshes`.
    pub(crate) mesh_triangles: Vec<usize>,
    pub(crate) materials: Vec<Value>,
    pub(crate) accessors: Vec<Value>,
    pub(crate) images: Vec<Value>,
    /// Images already added, by relative URI: URI enters table once.
    images_by_uri: HashMap<String, usize>,
    pub(crate) samplers: Vec<Value>,
    /// First sampler for each setting — repeat on both axes, then filter —,
    /// added or created.
    sampler_ids: HashMap<[u32; 4], usize>,
    pub(crate) textures: Vec<Value>,
    /// Lights declared by source, in order nodes instantiate them.
    pub(crate) lights: Vec<Value>,
    pub(crate) bin: Bin,
    pub(crate) report: Report,
    /// Published in report: instances, models, materials, discarded LODs…
    pub(crate) counts: BTreeMap<&'static str, usize>,
    /// Read data files with fingerprint: identity of this conversion.
    pub(crate) files: Vec<Value>,
    key_material: String,
}

impl SceneTables {
    pub(crate) fn new(plugin: &dyn ScenePlugin) -> Self {
        Self {
            key_material: format!("{}:{}", plugin.name(), plugin.version()),
            ..Self::default()
        }
    }
    pub(crate) fn count(&mut self, what: &'static str, by: usize) {
        *self.counts.entry(what).or_insert(0) += by;
    }
    /// Adds node and returns rank.
    pub(crate) fn node(&mut self, node: Value) -> usize {
        self.nodes.push(node);
        self.nodes.len() - 1
    }
    /// Sampler per repeat mode pair, filtered as glTF default.
    /// Format clamping one axis and repeating other carries two modes: confusing them
    /// folds the texture.
    pub(crate) fn sampler_uv(&mut self, wrap_s: u32, wrap_t: u32) -> usize {
        self.sampler_filtered([wrap_s, wrap_t, DEFAULT_FILTER[0], DEFAULT_FILTER[1]])
    }
    /// Sampler per complete setting — `wrapS`, `wrapT`, `magFilter`, `minFilter` —,
    /// shared by all requesting textures, including added model declaring it.
    /// Filtering belongs to texture like repeat: differently sampled textures
    /// do not share sampler.
    pub(crate) fn sampler_filtered(&mut self, setting: [u32; 4]) -> usize {
        if let Some(known) = self.sampler_ids.get(&setting) {
            return *known;
        }
        let [wrap_s, wrap_t, mag, min] = setting;
        self.samplers
            .push(json!({"magFilter":mag,"minFilter":min,"wrapS":wrap_s,"wrapT":wrap_t}));
        let id = self.samplers.len() - 1;
        self.sampler_ids.insert(setting, id);
        id
    }
    /// Notes samplers added from a model: first of each setting serves
    /// subsequently. Model not writing filtering takes glTF default.
    pub(crate) fn share_samplers(&mut self, ids: &[usize]) {
        for id in ids {
            let sampler = &self.samplers[*id];
            let read = |key: &str, default: u32| {
                sampler[key].as_u64().unwrap_or(u64::from(default)) as u32
            };
            let setting = match [&sampler["wrapS"], &sampler["wrapT"]].map(Value::as_u64) {
                [Some(wrap_s), Some(wrap_t)] => [
                    wrap_s as u32,
                    wrap_t as u32,
                    read("magFilter", DEFAULT_FILTER[0]),
                    read("minFilter", DEFAULT_FILTER[1]),
                ],
                _ => continue,
            };
            self.sampler_ids.entry(setting).or_insert(*id);
        }
    }
    /// Notes read data file: path, size, fingerprint enter key.
    pub(crate) fn read_file(&mut self, name: &str, bytes: usize, digest: &str) {
        self.files
            .push(json!({"file":name,"bytes":bytes,"sha256":digest}));
        self.key_material
            .push_str(&format!("\n{name}:{bytes}:{digest}"));
    }
    /// Notes driver-imported model: cache folder key is already fingerprint
    /// of its bytes, reused directly without re-reading file.
    pub(crate) fn read_model(&mut self, name: &str, plugin: &str, key: &str) {
        self.files
            .push(json!({"file":name,"plugin":plugin,"importKey":key}));
        self.key_material.push_str(&format!("\n{name}@{key}"));
    }

    /// Scene roots: nodes uncited as child by any other.
    fn roots(&self) -> Vec<usize> {
        let mut child = vec![false; self.nodes.len()];
        for node in &self.nodes {
            for id in node["children"].as_array().map_or(&[][..], Vec::as_slice) {
                if let Some(id) = id.as_u64() {
                    child[id as usize] = true;
                }
            }
        }
        (0..self.nodes.len()).filter(|id| !child[*id]).collect()
    }
}

impl SceneOutput for SceneTables {
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
        let triangles: usize = self
            .nodes
            .iter()
            .filter_map(|node| node["mesh"].as_u64())
            .map(|mesh| self.mesh_triangles[mesh as usize])
            .sum();
        let mesh_nodes = self
            .nodes
            .iter()
            .filter(|n| n.get("mesh").is_some())
            .count();
        let tables = Tables {
            nodes: &self.nodes,
            meshes: &self.meshes,
            materials: &self.materials,
            accessors: &self.accessors,
            images: &self.images,
            samplers: &self.samplers,
            textures: &self.textures,
            bin: &self.bin,
        };
        let mut document = tables.document(plugin, &self.roots());
        super::attach_lights(&mut document, &self.lights);
        let gltf_bytes = serde_json::to_vec(&document)?;
        write_scene(
            directory,
            &gltf_bytes,
            &self.bin,
            (mesh_nodes, triangles),
            &self.report,
            || {
                json!({
                    "plugin":crate::plugins::provenance(plugin),"path":source.to_string_lossy(),
                    "files":self.files,"counts":self.counts,"meshes":self.meshes.len(),
                    "materials":self.materials.len(),"images":self.images.len(),
                    "importMs":crate::shared_math::elapsed_ms(started),
                })
            },
        )?;
        Ok(directory.to_path_buf())
    }
}
