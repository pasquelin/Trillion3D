//! La scène intermédiaire en construction, et son écriture dans le cache, partagées par les pilotes
//! de scène qui remplissent eux-mêmes leurs tables glTF.
//!
//! Le pilote remplit les mêmes tables qu'un glTF 2.0 — nœuds, maillages, matériaux, accesseurs,
//! images — puis les publie en `model.gltf`, `model.bin` et `manifest.json`, la seule chose que le
//! compilateur sache lire. Ce qui est ici ne dépend d'aucun format : seul le remplissage en dépend.
//! Rien n'est jamais écrit à côté de la source.
use super::*;
mod media;
pub(crate) use media::readable;

/// Le filtrage qu'un échantillonneur porte sans mention contraire : linéaire à l'agrandissement,
/// linéaire entre mipmaps au rétrécissement.
const DEFAULT_FILTER: [u32; 2] = [9729, 9987];

/// Les tables du glTF en cours d'écriture.
pub(crate) struct SceneTables {
    pub(crate) nodes: Vec<Value>,
    pub(crate) meshes: Vec<Value>,
    /// Le nombre de triangles de chaque maillage, par rang de `meshes`.
    pub(crate) mesh_triangles: Vec<usize>,
    pub(crate) materials: Vec<Value>,
    pub(crate) accessors: Vec<Value>,
    pub(crate) images: Vec<Value>,
    /// Les images déjà versées, par URI relative : une URI n'entre qu'une fois dans la table.
    images_by_uri: HashMap<String, usize>,
    pub(crate) samplers: Vec<Value>,
    /// Le premier échantillonneur de chaque réglage — répétition des deux axes, puis filtrage —,
    /// versé ou créé.
    sampler_ids: HashMap<[u32; 4], usize>,
    pub(crate) textures: Vec<Value>,
    pub(crate) bin: Bin,
    pub(crate) report: Report,
    /// Ce que le rapport publie en clair : instances, modèles, matériaux, LOD écartés…
    pub(crate) counts: BTreeMap<&'static str, usize>,
    /// Les fichiers de données lus, avec leur empreinte : c'est l'identité de cette conversion.
    pub(crate) files: Vec<Value>,
    key_material: String,
}

impl SceneTables {
    pub(crate) fn new(plugin: &dyn ScenePlugin) -> Self {
        Self {
            nodes: Vec::new(),
            meshes: Vec::new(),
            mesh_triangles: Vec::new(),
            materials: Vec::new(),
            accessors: Vec::new(),
            images: Vec::new(),
            images_by_uri: HashMap::new(),
            samplers: Vec::new(),
            sampler_ids: HashMap::new(),
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
    pub(crate) fn count(&mut self, what: &'static str, by: usize) {
        *self.counts.entry(what).or_insert(0) += by;
    }
    /// Ajoute un nœud et rend son rang.
    pub(crate) fn node(&mut self, node: Value) -> usize {
        self.nodes.push(node);
        self.nodes.len() - 1
    }
    /// Un échantillonneur par couple de modes de répétition, filtré comme le glTF le fait par
    /// défaut. Un format qui borne un axe et répète l'autre porte bien deux modes : les confondre
    /// replie la texture.
    pub(crate) fn sampler_uv(&mut self, wrap_s: u32, wrap_t: u32) -> usize {
        self.sampler_filtered([wrap_s, wrap_t, DEFAULT_FILTER[0], DEFAULT_FILTER[1]])
    }
    /// Un échantillonneur par réglage complet — `wrapS`, `wrapT`, `magFilter`, `minFilter` —,
    /// partagé par toutes les textures qui le demandent, y compris celles d'un modèle versé qui
    /// déclare déjà ce réglage. Le filtrage appartient à la texture, comme sa répétition : deux
    /// textures qui ne s'échantillonnent pas pareil ne partagent pas un échantillonneur.
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
    /// Note les échantillonneurs versés depuis un modèle : le premier de chaque réglage sert
    /// ensuite. Un modèle qui n'écrit pas son filtrage prend celui du glTF par défaut.
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
    /// Note un fichier de données lu : son chemin, sa taille et son empreinte entrent dans la clé.
    pub(crate) fn read_file(&mut self, name: &str, bytes: usize, digest: &str) {
        self.files
            .push(json!({"file":name,"bytes":bytes,"sha256":digest}));
        self.key_material
            .push_str(&format!("\n{name}:{bytes}:{digest}"));
    }
    /// Note un modèle importé par son pilote : la clé de son dossier de cache est déjà l'empreinte
    /// de ses octets, on la reprend telle quelle plutôt que de relire le fichier.
    pub(crate) fn read_model(&mut self, name: &str, plugin: &str, key: &str) {
        self.files
            .push(json!({"file":name,"plugin":plugin,"importKey":key}));
        self.key_material.push_str(&format!("\n{name}@{key}"));
    }
    pub(crate) fn key(&self) -> String {
        hash(self.key_material.as_bytes())
    }

    /// Écrit la scène dans `<cache>/native/imports/<clé>/` et rend ce dossier.
    pub(crate) fn write(
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
        let gltf_bytes = serde_json::to_vec(&tables.document(plugin, &self.roots()))?;
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

    /// Les racines de la scène : les nœuds qu'aucun autre ne cite comme enfant.
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
