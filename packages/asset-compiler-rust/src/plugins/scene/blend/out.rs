//! The glTF tables this driver fills, and their writing into the cache.
//!
//! The driver reads raw geometry — vertices, corners, faces — and therefore has no accessor to
//! copy: it creates them. Each array goes into the binary through an aligned view, and the
//! accessor that names it carries the bounds glTF requires of positions.
use super::*;
use crate::import::{borrowed_tables, Converted};
use crate::plugins::scene::{scene_output_fields, SceneOutput};

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
    /// The bytes `bin` may reach: the job's RAM budget, less what the open file holds.
    pub(super) room: usize,
}

impl Out {
    pub(super) fn count(&mut self, what: &'static str, by: usize) {
        *self.counts.entry(what).or_insert(0) += by;
    }
    /// Refuses the scene, naming the `kind` and `name` that adds them, when `adding` bytes more
    /// take `bin`, which held `held`, past its room.
    pub(super) fn fit(&self, kind: &str, name: &str, held: usize, adding: usize) -> Result<()> {
        if held.saturating_add(adding) > self.room {
            return Err(refused(
                "blend-too-large",
                format!("blend: {kind} {name} needs {adding} bytes, and the scene binary already holds {held} of the {} bytes this job's RAM budget (ramBudgetMb) leaves it once the file is open", self.room),
            ));
        }
        Ok(())
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
    scene_output_fields!();
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
        Converted {
            tables: borrowed_tables!(self),
            roots: &self.roots,
            lights: &self.lights,
            report: &self.report,
            counts: &self.counts,
            files: self.files.clone(),
            stats: (mesh_nodes, self.triangles),
        }
        .write(plugin, directory, source, started)
    }
}
