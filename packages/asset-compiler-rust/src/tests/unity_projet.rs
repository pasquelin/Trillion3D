//! Un projet Unity jetable, écrit fichier par fichier, puis compilé par le harnais commun des
//! dorées. Chaque cas de fidélité pose le plus petit projet qui montre son comportement : une
//! fixture réelle en mêlerait dix. Rien n'est écrit hors du dossier jetable, et les modèles sont
//! des glTF binaires écrits ici même — des données, pas des assets d'éditeur.
use super::*;

/// L'entête que l'éditeur écrit en tête de chaque fichier sérialisé.
pub(super) const HEAD: &str = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n";
/// Le GUID des ressources intégrées de l'éditeur, et le `fileID` du cube parmi elles.
pub(super) const BUILTIN: &str = "{fileID: 10202, guid: 0000000000000000e000000000000000, type: 0}";

/// Un projet jetable et son dossier `Assets`.
pub(super) struct Projet {
    root: PathBuf,
}

impl Drop for Projet {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

impl Projet {
    pub(super) fn new(tag: &str) -> Projet {
        let root = scratch("unity-projet", tag);
        fs::create_dir_all(root.join("Assets")).expect("Assets");
        Projet { root }
    }

    /// Un asset quelconque sous `Assets`, ses dossiers créés au besoin, et le `.meta` que
    /// l'éditeur pose à côté : son GUID suivi du corps que le cas déclare.
    pub(super) fn asset(&self, relative: &str, bytes: &[u8], guid: &str, meta: &str) {
        let path = self.root.join("Assets").join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("dossier");
        }
        fs::write(&path, bytes).expect("asset");
        let mut name = path.into_os_string();
        name.push(".meta");
        fs::write(name, format!("fileFormatVersion: 2\nguid: {guid}\n{meta}")).expect("meta");
    }

    /// Un fichier de données et le `.meta` qui lui donne son GUID.
    pub(super) fn data(&self, relative: &str, guid: &str, body: &str) {
        self.asset(relative, format!("{HEAD}{body}").as_bytes(), guid, "");
    }

    /// Un modèle glTF binaire et le `.meta` de son `ModelImporter`. `names` porte les entrées de
    /// `internalIDToNameTable`, écrites telles que l'éditeur les sérialise.
    pub(super) fn model(&self, relative: &str, guid: &str, nodes: Value, names: &str) {
        self.model_bytes(relative, guid, &glb(nodes), names);
    }

    /// De même, pour un modèle d'un autre format : le pilote qui le revendique le lit.
    pub(super) fn model_bytes(&self, relative: &str, guid: &str, bytes: &[u8], names: &str) {
        let meta = format!("ModelImporter:\n  serializedVersion: 22\n  internalIDToNameTable:\n{names}  externalObjects: {{}}\n");
        self.asset(relative, bytes, guid, &meta);
    }

    /// La scène du projet, puis sa compilation par le harnais commun.
    pub(super) fn scene(&self, body: &str) {
        self.data("Map.unity", "000000000000000000000000000000e1", body);
    }
    pub(super) fn compile(&self, tag: &str) -> GoldenRun {
        compile_golden_source(&self.root.join("Assets").join("Map.unity"), tag)
    }
}

/// Un GameObject complet, transformation neutre sous le père que le cas nomme : `MeshFilter` sur ce
/// maillage, `MeshRenderer` sur ces matériaux. `id` réserve quatre `fileID` consécutifs, l'objet
/// puis ses trois composants.
pub(super) fn objet(id: u32, name: &str, mesh: &str, materials: &str, father: u32) -> String {
    let (transform, filter, renderer) = (id + 1, id + 2, id + 3);
    format!(
        "--- !u!1 &{id}\nGameObject:\n  serializedVersion: 6\n  m_Component:\n  - component: {{fileID: {transform}}}\n  - component: {{fileID: {filter}}}\n  - component: {{fileID: {renderer}}}\n  m_Name: {name}\n  m_IsActive: 1\n{}--- !u!33 &{filter}\nMeshFilter:\n  m_GameObject: {{fileID: {id}}}\n  m_Mesh: {mesh}\n--- !u!23 &{renderer}\nMeshRenderer:\n  m_GameObject: {{fileID: {id}}}\n  m_Enabled: 1\n  m_Materials: {materials}\n",
        transformation(transform, id, father)
    )
}

/// La `Transform` d'un objet, ses enfants et son père tels que le cas les nomme.
pub(super) fn transformation(id: u32, object: u32, father: u32) -> String {
    enfants(id, object, father, "[]")
}

/// De même, pour une `Transform` qui porte des enfants.
pub(super) fn enfants(id: u32, object: u32, father: u32, children: &str) -> String {
    format!(
        "--- !u!4 &{id}\nTransform:\n  m_GameObject: {{fileID: {object}}}\n  m_LocalRotation: {{x: 0, y: 0, z: 0, w: 1}}\n  m_LocalPosition: {{x: 0, y: 0, z: 0}}\n  m_LocalScale: {{x: 1, y: 1, z: 1}}\n  m_Children: {children}\n  m_Father: {{fileID: {father}}}\n"
    )
}

/// La liste de matériaux d'un `MeshRenderer` : un seul, celui de ce GUID.
pub(super) fn materiau(guid: &str) -> String {
    format!("\n  - {{fileID: 2100000, guid: {guid}, type: 2}}")
}

/// Un objet qui instancie le modèle entier, transformation neutre, sans matériau déclaré.
pub(super) fn instancie(name: &str, mesh: &str) -> String {
    objet(100, name, mesh, "[]", 0)
}

/// Un cube intégré de l'éditeur, portant le matériau de ce GUID.
pub(super) fn cube(id: u32, name: &str, guid: &str) -> String {
    objet(id, name, BUILTIN, &materiau(guid), 0)
}

/// Un `.mat` dont les flottants et les couleurs sont ceux du cas.
pub(super) fn mat(name: &str, floats: &str, colors: &str) -> String {
    format!(
        "--- !u!21 &2100000\nMaterial:\n  serializedVersion: 8\n  m_Name: {name}\n  m_SavedProperties:\n    serializedVersion: 3\n    m_TexEnvs: []\n    m_Floats:\n{floats}    m_Colors:\n{colors}"
    )
}

/// Un `.mat` blanc opaque : seuls ses flottants distinguent le cas.
pub(super) fn mat_blanc(name: &str, floats: &str) -> String {
    mat(name, floats, "    - _BaseColor: {r: 1, g: 1, b: 1, a: 1}\n")
}

/// Un glTF binaire d'un seul triangle, dont les nœuds sont ceux que le cas demande.
fn glb(nodes: Value) -> Vec<u8> {
    let mut bin = Vec::new();
    for value in [0f32, 0., 0., 1., 0., 0., 0., 1., 0.] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    for value in [0u32, 1, 2] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    let gltf = json!({
        "asset":{"version":"2.0"},
        "buffers":[{"byteLength":bin.len()}],
        "bufferViews":[
            {"buffer":0,"byteOffset":0,"byteLength":36},
            {"buffer":0,"byteOffset":36,"byteLength":12},
        ],
        "accessors":[
            {"bufferView":0,"componentType":5126,"type":"VEC3","count":3},
            {"bufferView":1,"componentType":5125,"type":"SCALAR","count":3},
        ],
        "meshes":[{"name":"Triangle","primitives":[{"attributes":{"POSITION":0},"indices":1}]}],
        "nodes":nodes,
    });
    encode_glb(&gltf, &bin)
}

/// Le nœud de ce nom dans la scène intermédiaire.
pub(super) fn node_named<'a>(gltf: &'a Value, name: &str) -> Option<&'a Value> {
    gltf["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .find(|node| node["name"] == name)
}

/// Le rang du matériau de ce nom, tel qu'un maillage le cite.
pub(super) fn material_index(gltf: &Value, name: &str) -> Value {
    let rank = gltf["materials"]
        .as_array()
        .expect("materials")
        .iter()
        .position(|material| material["name"] == name);
    json!(rank.unwrap_or_else(|| panic!("le matériau {name}")))
}

/// Le matériau de ce nom, tel que le pilote l'a écrit.
pub(super) fn material_named<'a>(gltf: &'a Value, name: &str) -> &'a Value {
    gltf["materials"]
        .as_array()
        .expect("materials")
        .iter()
        .find(|material| material["name"] == name)
        .unwrap_or_else(|| panic!("le matériau {name}"))
}
