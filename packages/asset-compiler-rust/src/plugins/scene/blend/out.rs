//! The glTF tables this driver fills, and their writing into the cache.
//!
//! The driver reads raw geometry — vertices, corners, faces — and therefore has no accessor to
//! copy: it creates them. Each array goes into the binary through an aligned view, and the
//! accessor that names it carries the bounds glTF requires of positions.
use super::*;
use crate::plugins::scene::SceneOutput;

/// The glTF component type of a single float, and that of a 32-bit unsigned integer.
const FLOAT: u32 = 5126;
const UINT: u32 = 5125;
/// glTF view targets: vertex attributes, and indices.
const ARRAY_BUFFER: u32 = 34962;
const ELEMENT_ARRAY_BUFFER: u32 = 34963;

/// The intermediate scene under construction.
#[derive(Default)]
pub(super) struct Out {
    pub(super) nodes: Vec<Value>,
    pub(super) meshes: Vec<Value>,
    pub(super) materials: Vec<Value>,
    pub(super) accessors: Vec<Value>,
    pub(super) images: Vec<Value>,
    pub(super) samplers: Vec<Value>,
    pub(super) textures: Vec<Value>,
    /// Lamps declared by the file, in the order nodes instantiate them.
    pub(super) lights: Vec<Value>,
    pub(super) bin: Bin,
    pub(super) report: Report,
    pub(super) counts: BTreeMap<&'static str, usize>,
    /// Nodes without a parent: the axis-conversion root, and it alone.
    pub(super) roots: Vec<usize>,
    /// Instanced triangles: those of each mesh-carrying node, not those of the meshes.
    pub(super) triangles: usize,
    /// What the cache key hashes: the driver, its version and the digest of the file read.
    pub(super) key_material: String,
    /// The file read, as the manifest publishes it.
    pub(super) files: Value,
}

impl Out {
    pub(super) fn count(&mut self, what: &'static str, by: usize) {
        *self.counts.entry(what).or_insert(0) += by;
    }
    /// A float accessor, of a given component count, poured into the binary.
    pub(super) fn floats(&mut self, values: &[f32], stride: usize, bounds: bool) -> usize {
        let kind = if stride == 2 { "VEC2" } else { "VEC3" };
        let view = self.bin.view(&f32_bytes(values), Some(ARRAY_BUFFER));
        let mut accessor = json!({
            "bufferView": view, "componentType": FLOAT,
            "count": values.len() / stride, "type": kind,
        });
        if bounds {
            let (low, high) = extent(values, stride);
            accessor["min"] = json!(low);
            accessor["max"] = json!(high);
        }
        self.accessors.push(accessor);
        self.accessors.len() - 1
    }
    /// An index accessor, poured into the binary.
    pub(super) fn indices(&mut self, values: &[u32]) -> usize {
        let mut bytes = Vec::with_capacity(values.len() * 4);
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        let view = self.bin.view(&bytes, Some(ELEMENT_ARRAY_BUFFER));
        self.accessors.push(json!({
            "bufferView": view, "componentType": UINT,
            "count": values.len(), "type": "SCALAR",
        }));
        self.accessors.len() - 1
    }
    /// An image poured into the tables, with the texture that serves it.
    pub(super) fn image(&mut self, image: Value) -> usize {
        self.images.push(image);
        let sampler = self.sampler();
        self.textures
            .push(json!({"source": self.images.len() - 1, "sampler": sampler}));
        self.count("textures", 1);
        self.textures.len() - 1
    }
    /// The driver's only sampler: Blender repeats its textures by default, and this driver does
    /// not read the coordinate nodes that would say otherwise.
    fn sampler(&mut self) -> usize {
        if self.samplers.is_empty() {
            self.samplers
                .push(json!({"magFilter":9729,"minFilter":9987,"wrapS":10497,"wrapT":10497}));
        }
        self.samplers.len() - 1
    }
}

impl SceneOutput for Out {
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
        started: Instant,
    ) -> Result<PathBuf> {
        let mesh_nodes = self
            .nodes
            .iter()
            .filter(|node| node.get("mesh").is_some())
            .count();
        let document = Tables {
            nodes: &self.nodes,
            meshes: &self.meshes,
            materials: &self.materials,
            accessors: &self.accessors,
            images: &self.images,
            samplers: &self.samplers,
            textures: &self.textures,
            bin: &self.bin,
        }
        .document(plugin, &self.roots);
        let mut document = document;
        crate::import::attach_lights(&mut document, &self.lights);
        let gltf = serde_json::to_vec(&document)?;
        write_scene(
            directory,
            &gltf,
            &self.bin,
            (mesh_nodes, self.triangles),
            &self.report,
            || {
                json!({
                    "plugin": crate::plugins::provenance(plugin),
                    "path": source.to_string_lossy(), "files": self.files, "counts": self.counts,
                    "meshes": self.meshes.len(), "materials": self.materials.len(),
                    "images": self.images.len(),
                    "importMs": started.elapsed().as_secs_f64() * 1000.0,
                })
            },
        )?;
        Ok(directory.to_path_buf())
    }
}

/// Bounds of a vector array, component by component: glTF requires them of positions.
fn extent(values: &[f32], stride: usize) -> (Vec<f32>, Vec<f32>) {
    if values.is_empty() {
        return (vec![0.0; stride], vec![0.0; stride]);
    }
    let mut low = vec![f32::INFINITY; stride];
    let mut high = vec![f32::NEG_INFINITY; stride];
    for vector in values.chunks_exact(stride) {
        for axis in 0..stride {
            low[axis] = low[axis].min(vector[axis]);
            high[axis] = high[axis].max(vector[axis]);
        }
    }
    (low, high)
}
