//! La scène intermédiaire en construction, et son écriture dans le cache.
//!
//! Le pilote remplit les mêmes tables qu'un glTF 2.0 — nœuds, maillages, matériaux, accesseurs,
//! images — puis les publie en `model.gltf`, `model.bin` et `manifest.json`, la seule chose que le
//! compilateur sache lire. Rien n'est jamais écrit à côté de la source.
use super::*;

/// Les tables du glTF en cours d'écriture.
pub(super) struct Scene {
    pub(super) nodes: Vec<Value>,
    pub(super) meshes: Vec<Value>,
    /// Le nombre de triangles de chaque maillage, par rang de `meshes`.
    pub(super) mesh_triangles: Vec<usize>,
    pub(super) materials: Vec<Value>,
    pub(super) accessors: Vec<Value>,
    pub(super) images: Vec<Value>,
    pub(super) samplers: Vec<Value>,
    pub(super) textures: Vec<Value>,
    pub(super) bin: Bin,
    pub(super) report: Report,
    /// Ce que le rapport publie en clair : instances, modèles, matériaux, LOD écartés…
    pub(super) counts: BTreeMap<&'static str, usize>,
    /// Les fichiers de données lus, avec leur empreinte : c'est l'identité de cette conversion.
    pub(super) files: Vec<Value>,
    key_material: String,
}

impl Scene {
    pub(super) fn new(plugin: &dyn ScenePlugin) -> Scene {
        Scene {
            nodes: Vec::new(),
            meshes: Vec::new(),
            mesh_triangles: Vec::new(),
            materials: Vec::new(),
            accessors: Vec::new(),
            images: Vec::new(),
            samplers: Vec::new(),
            textures: Vec::new(),
            bin: Bin {
                bytes: Vec::new(),
                views: Vec::new(),
            },
            report: Report::default(),
            counts: BTreeMap::new(),
            files: Vec::new(),
            key_material: format!("{}:{}", plugin.name(), plugin.version()),
        }
    }
    pub(super) fn count(&mut self, what: &'static str, by: usize) {
        *self.counts.entry(what).or_insert(0) += by;
    }
    /// Ajoute un nœud et rend son rang.
    pub(super) fn node(&mut self, node: Value) -> usize {
        self.nodes.push(node);
        self.nodes.len() - 1
    }
    /// Un échantillonneur par mode de répétition, partagé par toutes les textures qui le demandent.
    pub(super) fn sampler(&mut self, wrap: u32) -> usize {
        let existing = self
            .samplers
            .iter()
            .position(|sampler| sampler["wrapS"] == json!(wrap));
        existing.unwrap_or_else(|| {
            self.samplers
                .push(json!({"magFilter":9729,"minFilter":9987,"wrapS":wrap,"wrapT":wrap}));
            self.samplers.len() - 1
        })
    }
    /// Note un fichier de données lu : son chemin, sa taille et son empreinte entrent dans la clé.
    pub(super) fn read_file(&mut self, name: &str, bytes: usize, digest: &str) {
        self.files
            .push(json!({"file":name,"bytes":bytes,"sha256":digest}));
        self.key_material
            .push_str(&format!("\n{name}:{bytes}:{digest}"));
    }
    /// Note un modèle importé par son pilote : la clé de son dossier de cache est déjà l'empreinte
    /// de ses octets, on la reprend telle quelle plutôt que de relire le fichier.
    pub(super) fn read_model(&mut self, name: &str, plugin: &str, key: &str) {
        self.files
            .push(json!({"file":name,"plugin":plugin,"importKey":key}));
        self.key_material.push_str(&format!("\n{name}@{key}"));
    }
    pub(super) fn key(&self) -> String {
        hash(self.key_material.as_bytes())
    }

    /// Le document glTF complet.
    fn document(&self, plugin: &dyn ScenePlugin) -> Value {
        let roots: Vec<usize> = {
            let mut child = vec![false; self.nodes.len()];
            for node in &self.nodes {
                for id in node["children"].as_array().map_or(&[][..], Vec::as_slice) {
                    if let Some(id) = id.as_u64() {
                        child[id as usize] = true;
                    }
                }
            }
            (0..self.nodes.len()).filter(|id| !child[*id]).collect()
        };
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

    /// Écrit la scène dans `<cache>/native/imports/<clé>/` et rend ce dossier.
    pub(super) fn write(
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
        let gltf_bytes = serde_json::to_vec(&self.document(plugin))?;
        fs::create_dir_all(directory)?;
        atomic(&directory.join("model.bin"), &self.bin.bytes)?;
        atomic(&directory.join("model.gltf"), &gltf_bytes)?;
        let mut manifest = runtime_manifest(
            "model.gltf",
            &hash(&gltf_bytes),
            &[("model.bin".to_string(), hash(&self.bin.bytes))],
            mesh_nodes,
            triangles,
        );
        manifest["runtime"]["bytes"] = json!(gltf_bytes.len());
        manifest["source"] = json!({
            "plugin":crate::plugins::provenance(plugin),"path":source.to_string_lossy(),
            "files":self.files,"counts":self.counts,"meshes":self.meshes.len(),
            "materials":self.materials.len(),"images":self.images.len(),
            "importMs":started.elapsed().as_secs_f64()*1000.0,
        });
        manifest["unsupported"] = json!(self.report.unsupported);
        manifest["notes"] = json!(self.report.notes);
        atomic(
            &directory.join("manifest.json"),
            &serde_json::to_vec_pretty(&manifest)?,
        )?;
        Ok(directory.to_path_buf())
    }
}
