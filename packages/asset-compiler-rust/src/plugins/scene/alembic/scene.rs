//! La scène intermédiaire en construction, et son écriture dans le cache.
//!
//! Alembic ne porte ni image, ni texture, ni nuancier : un face set y nomme un matériau, sans rien
//! en dire. Les tables écrites ici sont donc celles de la géométrie seule — nœuds, maillages,
//! matériaux neutres, accesseurs — et un maillage dont les octets sont ceux d'un maillage déjà écrit
//! n'est pas écrit deux fois : un fichier qui répète le même objet ne pèse qu'une fois dans la
//! scène, et ses répétitions ne sont plus que des nœuds.
use self::write::digest;
use super::mesh::{FaceSet, Part};
use super::*;
use crate::import::mesh::index_bytes;
use crate::import::{f32_bytes, Bin, Report};
use std::collections::{BTreeMap, HashMap};

mod write;

/// Le facteur de rugosité d'un matériau sans nuancier : une surface diffuse, ni métal ni miroir.
const NEUTRAL: [f64; 2] = [0.0, 1.0];

/// Les tables du glTF en cours d'écriture.
#[derive(Default)]
pub(super) struct Scene {
    pub(super) nodes: Vec<Value>,
    pub(super) meshes: Vec<Value>,
    /// Le nombre de triangles de chaque maillage, par rang de `meshes`.
    mesh_triangles: Vec<usize>,
    pub(super) materials: Vec<Value>,
    accessors: Vec<Value>,
    bin: Bin,
    pub(super) report: Report,
    /// Ce que le rapport publie en clair : objets, maillages, face sets, refus comptés.
    pub(super) counts: BTreeMap<&'static str, usize>,
    /// Les racines de la scène, dans l'ordre où le parcours les a trouvées.
    pub(super) roots: Vec<usize>,
    /// Le matériau de chaque nom de face set : deux maillages qui nomment le même en partagent un.
    material_ids: HashMap<String, usize>,
    /// Le maillage de chaque empreinte de contenu : la géométrie répétée n'est écrite qu'une fois.
    mesh_ids: HashMap<String, usize>,
    /// Les nœuds porteurs de maillage et leurs triangles, suivis à mesure qu'ils sont posés.
    pub(super) instanced: (usize, usize),
    key_material: String,
}

impl Scene {
    /// Une scène vide, dont la clé de cache part du nom et de la version du pilote.
    pub(super) fn new(plugin: &dyn ScenePlugin) -> Scene {
        Scene {
            key_material: format!("{}:{}", plugin.name(), plugin.version()),
            ..Scene::default()
        }
    }

    pub(super) fn count(&mut self, what: &'static str, by: usize) {
        *self.counts.entry(what).or_insert(0) += by;
    }

    /// Ajoute un nœud et rend son rang. Un nœud porteur de maillage compte aussi ses triangles :
    /// la même géométrie posée deux fois pèse deux fois dans ce que le moteur affichera.
    pub(super) fn node(&mut self, node: Value) -> usize {
        if let Some(mesh) = node["mesh"].as_u64() {
            self.instanced.0 += 1;
            self.instanced.1 += self.mesh_triangles[mesh as usize];
        }
        self.nodes.push(node);
        self.nodes.len() - 1
    }

    /// Le matériau que ce face set nomme. Alembic ne porte aucun nuancier : le matériau est neutre,
    /// et seul son nom vient du fichier. Lui inventer une couleur serait ajouter ce que la source
    /// n'a pas.
    fn material(&mut self, name: &str) -> usize {
        if let Some(known) = self.material_ids.get(name) {
            return *known;
        }
        self.materials
            .push(json!({"name": name, "pbrMetallicRoughness": {
            "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
            "metallicFactor": NEUTRAL[0], "roughnessFactor": NEUTRAL[1]}}));
        let id = self.materials.len() - 1;
        self.material_ids.insert(name.to_string(), id);
        id
    }

    /// Écrit un maillage et rend son rang, ou rend celui d'un maillage aux mêmes octets.
    pub(super) fn mesh(&mut self, name: &str, parts: &[Part], facesets: &[FaceSet]) -> usize {
        let digest = digest(parts, facesets);
        if let Some(known) = self.mesh_ids.get(&digest).copied() {
            self.count("instancedMeshes", 1);
            return known;
        }
        let mut primitives = Vec::new();
        let mut triangles = 0;
        for part in parts {
            let material = part
                .faceset
                .and_then(|rank| facesets.get(rank))
                .map(|faceset| self.material(&faceset.name));
            triangles += part.indices.len() / 3;
            primitives.push(self.primitive(part, material));
        }
        self.meshes
            .push(json!({"name": name, "primitives": primitives}));
        self.mesh_triangles.push(triangles);
        let id = self.meshes.len() - 1;
        self.mesh_ids.insert(digest, id);
        id
    }

    /// Une primitive et ses accesseurs. Un attribut absent de la source reste absent du glTF : rien
    /// n'est calculé à la place de ce que le fichier n'a pas écrit.
    fn primitive(&mut self, part: &Part, material: Option<usize>) -> Value {
        let vertices = part.positions.len() / 3;
        let mut attributes = json!({});
        let view = self.bin.view(&f32_bytes(&part.positions), Some(34962));
        self.accessors
            .push(json!({"bufferView": view, "componentType": 5126,
            "count": vertices, "type": "VEC3", "min": part.min, "max": part.max}));
        attributes["POSITION"] = json!(self.accessors.len() - 1);
        for (name, values, kind) in [
            ("NORMAL", &part.normals, "VEC3"),
            ("TEXCOORD_0", &part.uvs, "VEC2"),
        ] {
            if values.is_empty() {
                continue;
            }
            let view = self.bin.view(&f32_bytes(values), Some(34962));
            self.accessors.push(
                json!({"bufferView": view, "componentType": 5126, "count": vertices, "type": kind}),
            );
            attributes[name] = json!(self.accessors.len() - 1);
        }
        let (bytes, component) = index_bytes(&part.indices, vertices);
        let view = self.bin.view(&bytes, Some(34963));
        self.accessors
            .push(json!({"bufferView": view, "componentType": component,
            "count": part.indices.len(), "type": "SCALAR"}));
        let mut primitive =
            json!({"attributes": attributes, "indices": self.accessors.len() - 1, "mode": 4});
        if let Some(material) = material {
            primitive["material"] = json!(material);
        }
        primitive
    }

    /// Note un fichier lu : son nom, sa taille et son empreinte entrent dans la clé du cache.
    pub(super) fn read_file(&mut self, name: &str, bytes: usize, digest: &str) {
        self.key_material
            .push_str(&format!("\n{name}:{bytes}:{digest}"));
    }
}
