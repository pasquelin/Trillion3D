//! Un projet Unity jetable, écrit fichier par fichier, puis compilé par le harnais commun des
//! dorées. Chaque cas de fidélité pose le plus petit projet qui montre son comportement : une
//! fixture réelle en mêlerait dix. Rien n'est écrit hors du dossier jetable, et les modèles sont
//! des glTF binaires écrits ici même — des données, pas des assets d'éditeur.
use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

/// L'entête que l'éditeur écrit en tête de chaque fichier sérialisé.
pub(super) const HEAD: &str = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n";

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
        let root = std::env::temp_dir().join(format!(
            "wg-unity-projet-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(root.join("Assets")).expect("Assets");
        Projet { root }
    }

    /// Le chemin d'un fichier sous `Assets`, ses dossiers créés au besoin.
    fn path(&self, relative: &str) -> PathBuf {
        let path = self.root.join("Assets").join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("dossier");
        }
        path
    }

    /// Un fichier de données et le `.meta` qui lui donne son GUID.
    pub(super) fn data(&self, relative: &str, guid: &str, body: &str) {
        let path = self.path(relative);
        fs::write(&path, format!("{HEAD}{body}")).expect("données");
        fs::write(
            meta_path(&path),
            format!("fileFormatVersion: 2\nguid: {guid}\n"),
        )
        .expect("meta");
    }

    /// Un modèle glTF binaire et le `.meta` de son `ModelImporter`. `names` porte les entrées de
    /// `internalIDToNameTable`, écrites telles que l'éditeur les sérialise.
    pub(super) fn model(&self, relative: &str, guid: &str, nodes: Value, names: &str) {
        let path = self.path(relative);
        fs::write(&path, glb(nodes)).expect("modèle");
        fs::write(
            meta_path(&path),
            format!("fileFormatVersion: 2\nguid: {guid}\nModelImporter:\n  serializedVersion: 22\n  internalIDToNameTable:\n{names}  externalObjects: {{}}\n"),
        )
        .expect("meta");
    }

    /// La scène du projet, puis sa compilation par le harnais commun.
    pub(super) fn scene(&self, body: &str) {
        self.data("Map.unity", "000000000000000000000000000000e1", body);
    }
    pub(super) fn compile(&self, tag: &str) -> GoldenRun {
        compile_golden_source(&self.root.join("Assets").join("Map.unity"), tag)
    }
}

/// Le `.meta` qu'Unity pose à côté d'un asset : son nom suivi de `.meta`.
fn meta_path(asset: &Path) -> PathBuf {
    let mut name = asset.as_os_str().to_os_string();
    name.push(".meta");
    PathBuf::from(name)
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
