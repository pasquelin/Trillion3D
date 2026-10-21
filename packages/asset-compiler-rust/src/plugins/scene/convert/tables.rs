//! Intermediate scene being built, and write to cache, shared by scene drivers
//! filling their own glTF tables.
//!
//! Driver fills same tables as glTF 2.0 — nodes, meshes, materials, accessors,
//! images — then publishes `model.gltf`, `model.bin`, and `manifest.json`, the only thing
//! compiler reads. Format-independent: only population depends on format.
//! Nothing written alongside source.
use super::*;
use crate::plugins::scene::corners::Corners;
use crate::plugins::scene::{scene_output_fields, SceneOutput};
pub(crate) mod media;

use crate::compiler::accessor::codes::DEFAULT_FILTER;

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
    /// Each texture's rank by its (image, sampler) pair: a pair enters the table once.
    textures_by_pair: HashMap<(usize, usize), usize>,
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
    /// Adds a light to the `KHR_lights_punctual` table and returns its rank: the one way every
    /// driver writes a light, in the extension's own fields (`LightSource::json`).
    pub(crate) fn light(&mut self, source: &crate::plugins::scene::convert::LightSource) -> usize {
        self.lights.push(source.json());
        self.lights.len() - 1
    }
    /// Adds node and returns rank.
    pub(crate) fn node(&mut self, node: Value) -> usize {
        self.nodes.push(node);
        self.nodes.len() - 1
    }
    /// Adds mesh of `triangles` triangles and returns rank.
    pub(crate) fn mesh(&mut self, mesh: Value, triangles: usize) -> usize {
        self.meshes.push(mesh);
        self.mesh_triangles.push(triangles);
        self.meshes.len() - 1
    }
    /// Adds mesh `name` of the primitives its parts yielded, each with its triangle count, and
    /// returns rank; a mesh none of whose parts yielded one is counted as `refused`, not added.
    pub(crate) fn mesh_of_parts(
        &mut self,
        name: &str,
        parts: Vec<(Value, usize)>,
        refused: &str,
    ) -> Option<usize> {
        if parts.is_empty() {
            self.report.add(refused);
            return None;
        }
        let triangles = parts.iter().map(|(_, count)| count).sum();
        let primitives: Vec<Value> = parts.into_iter().map(|(primitive, _)| primitive).collect();
        Some(self.mesh(json!({"name": name, "primitives": primitives}), triangles))
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
    /// `read_file` of a source `file`, named by its file name.
    pub(crate) fn read_source(&mut self, file: &Path, bytes: usize, digest: &str) {
        let name = file.file_name().unwrap_or_default().to_string_lossy();
        self.read_file(&name, bytes, digest);
    }
    /// Notes driver-imported model: cache folder key is already fingerprint
    /// of its bytes, reused directly without re-reading file.
    pub(crate) fn read_model(&mut self, name: &str, plugin: &str, key: &str) {
        self.files
            .push(json!({"file":name,"plugin":plugin,"importKey":key}));
        self.key_material.push_str(&format!("\n{name}@{key}"));
    }

    /// A driver's material part written as a primitive, with its triangle count; `None` when
    /// the part drew no triangle. The faces its cut had to fan are counted (`NGON_UNCUT`).
    pub(crate) fn part_primitive<K>(
        &mut self,
        corners: Corners<K>,
        material: Option<usize>,
    ) -> Option<(Value, usize)> {
        let uncut = crate::plugins::scene::codes::NGON_UNCUT;
        self.report.add_count(uncut, corners.uncut);
        let out = &corners.vertices;
        if out.indices.is_empty() {
            return None;
        }
        let value = primitive(out, &mut self.bin, &mut self.accessors, material);
        Some((value, out.indices.len() / 3))
    }

    /// Mesh-carrying nodes and the triangles they draw: a mesh posed twice weighs twice.
    pub(crate) fn stats(&self) -> (usize, usize) {
        let meshes = self.nodes.iter().filter_map(|node| node["mesh"].as_u64());
        let triangles = meshes
            .clone()
            .map(|mesh| self.mesh_triangles[mesh as usize]);
        (meshes.count(), triangles.sum())
    }

    /// Scene roots: nodes uncited as child by any other (`hierarchy_roots`).
    pub(crate) fn roots(&self) -> Result<Vec<usize>> {
        crate::compiler::source::nodes::hierarchy_roots(&self.nodes)
    }
}

impl SceneOutput for SceneTables {
    scene_output_fields!();
    fn write(
        self,
        plugin: &dyn ScenePlugin,
        directory: &Path,
        source: &Path,
        started: std::time::Instant,
    ) -> Result<PathBuf> {
        Converted {
            tables: borrowed_tables!(self),
            roots: &self.roots()?,
            lights: &self.lights,
            report: &self.report,
            counts: &self.counts,
            files: json!(self.files),
            stats: self.stats(),
        }
        .write(plugin, directory, source, started)
    }
}
