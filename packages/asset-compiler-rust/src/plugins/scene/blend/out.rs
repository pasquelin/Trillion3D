//! Les tables glTF que ce pilote remplit, et leur écriture dans le cache.
//!
//! Le pilote lit une géométrie brute — des sommets, des coins, des faces — et n'a donc aucun
//! accesseur à recopier : il en crée. Chaque tableau part dans le binaire par une vue alignée, et
//! l'accesseur qui la nomme porte les bornes que le glTF exige des positions.
use super::*;

/// Le type de composant glTF d'un flottant simple, et celui d'un entier non signé de 32 bits.
const FLOAT: u32 = 5126;
const UINT: u32 = 5125;
/// Les cibles de vue glTF : attributs de sommet, et indices.
const ARRAY_BUFFER: u32 = 34962;
const ELEMENT_ARRAY_BUFFER: u32 = 34963;

/// La scène intermédiaire en construction.
pub(super) struct Out {
    pub(super) nodes: Vec<Value>,
    pub(super) meshes: Vec<Value>,
    pub(super) materials: Vec<Value>,
    pub(super) accessors: Vec<Value>,
    pub(super) images: Vec<Value>,
    pub(super) samplers: Vec<Value>,
    pub(super) textures: Vec<Value>,
    /// Les lampes déclarées par le fichier, dans l'ordre où les nœuds les instancient.
    pub(super) lights: Vec<Value>,
    pub(super) bin: Bin,
    pub(super) report: Report,
    pub(super) counts: BTreeMap<&'static str, usize>,
    /// Les nœuds sans père : la racine de conversion d'axes, et elle seule.
    pub(super) roots: Vec<usize>,
    /// Les triangles instanciés : ceux de chaque nœud porteur de maillage, pas ceux des maillages.
    pub(super) triangles: usize,
}

impl Out {
    pub(super) fn new() -> Out {
        Out {
            nodes: Vec::new(),
            meshes: Vec::new(),
            materials: Vec::new(),
            accessors: Vec::new(),
            images: Vec::new(),
            samplers: Vec::new(),
            textures: Vec::new(),
            lights: Vec::new(),
            bin: Bin {
                bytes: Vec::new(),
                views: Vec::new(),
            },
            report: Report::default(),
            counts: BTreeMap::new(),
            roots: Vec::new(),
            triangles: 0,
        }
    }
    pub(super) fn count(&mut self, what: &'static str, by: usize) {
        *self.counts.entry(what).or_insert(0) += by;
    }
    /// Un accesseur de flottants, d'un nombre de composants donné, versé dans le binaire.
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
    /// Un accesseur d'indices, versé dans le binaire.
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
    /// Une image versée dans les tables, avec la texture qui la sert.
    pub(super) fn image(&mut self, image: Value) -> usize {
        self.images.push(image);
        let sampler = self.sampler();
        self.textures
            .push(json!({"source": self.images.len() - 1, "sampler": sampler}));
        self.count("textures", 1);
        self.textures.len() - 1
    }
    /// L'unique échantillonneur du pilote : Blender répète ses textures par défaut, et ce pilote ne
    /// lit pas les nœuds de coordonnées qui diraient autre chose.
    fn sampler(&mut self) -> usize {
        if self.samplers.is_empty() {
            self.samplers
                .push(json!({"magFilter":9729,"minFilter":9987,"wrapS":10497,"wrapT":10497}));
        }
        self.samplers.len() - 1
    }

    /// Écrit la scène dans `directory` et rend ce dossier.
    pub(super) fn write(
        self,
        plugin: &dyn ScenePlugin,
        directory: &Path,
        source: &Path,
        files: Value,
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
                    "path": source.to_string_lossy(), "files": files, "counts": self.counts,
                    "meshes": self.meshes.len(), "materials": self.materials.len(),
                    "images": self.images.len(),
                    "importMs": started.elapsed().as_secs_f64() * 1000.0,
                })
            },
        )?;
        Ok(directory.to_path_buf())
    }
}

/// Les bornes d'un tableau de vecteurs, composante par composante : le glTF les exige des positions.
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
