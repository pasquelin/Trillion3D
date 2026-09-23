//! A throwaway Unity project, written file by file, then compiled by the common
//! golden harness. Each fidelity case poses the smallest project that shows its
//! behaviour: a real fixture would mix ten. Nothing is written outside the throwaway
//! folder, and the models are binary glTF written here — data, not editor assets.
use super::*;

/// Header the editor writes at the start of every serialised file.
pub(in crate::tests) const HEAD: &str = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n";
/// GUID of the editor's built-in resources, and the `fileID` of the cube among them.
pub(in crate::tests) const BUILTIN: &str =
    "{fileID: 10202, guid: 0000000000000000e000000000000000, type: 0}";

/// A throwaway project and its `Assets` folder.
pub(in crate::tests) struct Projet {
    root: PathBuf,
}

impl Drop for Projet {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

impl Projet {
    pub(in crate::tests) fn new(tag: &str) -> Projet {
        let root = scratch("unity-projet", tag);
        fs::create_dir_all(root.join("Assets")).expect("Assets");
        Projet { root }
    }

    /// Any asset under `Assets`, its folders created as needed, and the `.meta` the
    /// editor places beside it: its GUID followed by the body the case declares.
    pub(in crate::tests) fn asset(&self, relative: &str, bytes: &[u8], guid: &str, meta: &str) {
        let path = self.root.join("Assets").join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("folder");
        }
        fs::write(&path, bytes).expect("asset");
        let mut name = path.into_os_string();
        name.push(".meta");
        fs::write(name, format!("fileFormatVersion: 2\nguid: {guid}\n{meta}")).expect("meta");
    }

    /// A data file and the `.meta` that gives it its GUID.
    pub(in crate::tests) fn data(&self, relative: &str, guid: &str, body: &str) {
        self.asset(relative, format!("{HEAD}{body}").as_bytes(), guid, "");
    }

    /// A binary glTF model and the `.meta` of its `ModelImporter`. `names` carries the
    /// `internalIDToNameTable` entries, written as the editor serialises them.
    pub(in crate::tests) fn model(&self, relative: &str, guid: &str, nodes: Value, names: &str) {
        self.model_bytes(relative, guid, &glb(nodes), names);
    }

    /// Likewise, for a model of another format: the driver that claims it reads it.
    pub(in crate::tests) fn model_bytes(
        &self,
        relative: &str,
        guid: &str,
        bytes: &[u8],
        names: &str,
    ) {
        let meta = format!("ModelImporter:\n  serializedVersion: 22\n  internalIDToNameTable:\n{names}  externalObjects: {{}}\n");
        self.asset(relative, bytes, guid, &meta);
    }

    /// The project's scene, then its compilation by the common harness.
    pub(in crate::tests) fn scene(&self, body: &str) {
        self.data("Map.unity", "000000000000000000000000000000e1", body);
    }
    pub(in crate::tests) fn compile(&self, tag: &str) -> GoldenRun {
        compile_golden_source(&self.root.join("Assets").join("Map.unity"), tag)
    }
}

/// A complete GameObject, neutral transform under the parent the case names:
/// `MeshFilter` on this mesh, `MeshRenderer` on these materials. `id` reserves four
/// consecutive `fileID`s, the object then its three components.
pub(in crate::tests) fn objet(
    id: u32,
    name: &str,
    mesh: &str,
    materials: &str,
    father: u32,
) -> String {
    let (transform, filter, renderer) = (id + 1, id + 2, id + 3);
    format!(
        "--- !u!1 &{id}\nGameObject:\n  serializedVersion: 6\n  m_Component:\n  - component: {{fileID: {transform}}}\n  - component: {{fileID: {filter}}}\n  - component: {{fileID: {renderer}}}\n  m_Name: {name}\n  m_IsActive: 1\n{}--- !u!33 &{filter}\nMeshFilter:\n  m_GameObject: {{fileID: {id}}}\n  m_Mesh: {mesh}\n--- !u!23 &{renderer}\nMeshRenderer:\n  m_GameObject: {{fileID: {id}}}\n  m_Enabled: 1\n  m_Materials: {materials}\n",
        transformation(transform, id, father)
    )
}

/// The `Transform` of an object, its children and its parent as the case names them.
pub(in crate::tests) fn transformation(id: u32, object: u32, father: u32) -> String {
    enfants(id, object, father, "[]")
}

/// Likewise, for a `Transform` that carries children.
pub(in crate::tests) fn enfants(id: u32, object: u32, father: u32, children: &str) -> String {
    format!(
        "--- !u!4 &{id}\nTransform:\n  m_GameObject: {{fileID: {object}}}\n  m_LocalRotation: {{x: 0, y: 0, z: 0, w: 1}}\n  m_LocalPosition: {{x: 0, y: 0, z: 0}}\n  m_LocalScale: {{x: 1, y: 1, z: 1}}\n  m_Children: {children}\n  m_Father: {{fileID: {father}}}\n"
    )
}

/// Material list of a `MeshRenderer`: a single one, that of this GUID.
pub(in crate::tests) fn materiau(guid: &str) -> String {
    format!("\n  - {{fileID: 2100000, guid: {guid}, type: 2}}")
}

/// An object that instantiates the whole model, neutral transform, no declared material.
pub(in crate::tests) fn instancie(name: &str, mesh: &str) -> String {
    objet(100, name, mesh, "[]", 0)
}

/// An editor built-in cube, carrying the material of this GUID.
pub(in crate::tests) fn cube(id: u32, name: &str, guid: &str) -> String {
    objet(id, name, BUILTIN, &materiau(guid), 0)
}

/// A `.mat` whose floats and colours are those of the case.
pub(in crate::tests) fn mat(name: &str, floats: &str, colors: &str) -> String {
    format!(
        "--- !u!21 &2100000\nMaterial:\n  serializedVersion: 8\n  m_Name: {name}\n  m_SavedProperties:\n    serializedVersion: 3\n    m_TexEnvs: []\n    m_Floats:\n{floats}    m_Colors:\n{colors}"
    )
}

/// An opaque white `.mat`: only its floats distinguish the case.
pub(in crate::tests) fn mat_blanc(name: &str, floats: &str) -> String {
    mat(name, floats, "    - _BaseColor: {r: 1, g: 1, b: 1, a: 1}\n")
}

/// A binary glTF of a single triangle, whose nodes are those the case asks for.
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

/// The node of this name in the intermediate scene.
pub(in crate::tests) fn node_named<'a>(gltf: &'a Value, name: &str) -> Option<&'a Value> {
    gltf["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .find(|node| node["name"] == name)
}

/// Rank of the material of this name, as a mesh cites it.
pub(in crate::tests) fn material_index(gltf: &Value, name: &str) -> Value {
    let rank = gltf["materials"]
        .as_array()
        .expect("materials")
        .iter()
        .position(|material| material["name"] == name);
    json!(rank.unwrap_or_else(|| panic!("the material {name}")))
}

/// The material of this name, as the driver wrote it.
pub(in crate::tests) fn material_named<'a>(gltf: &'a Value, name: &str) -> &'a Value {
    gltf["materials"]
        .as_array()
        .expect("materials")
        .iter()
        .find(|material| material["name"] == name)
        .unwrap_or_else(|| panic!("the material {name}"))
}
