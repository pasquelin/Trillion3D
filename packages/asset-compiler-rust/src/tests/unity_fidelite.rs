//! Ce que la scène Unity dit et que le pilote doit rendre tel quel : la place d'un modèle importé
//! dans sa propre hiérarchie, l'objet que chaque retouche de prefab vise, le mode alpha d'un
//! matériau, et le `fileID` de soixante-quatre bits qui nomme un maillage.
//!
//! Le doré du pilote est dans `unity_golden.rs`, ses refus dans `unity_driver.rs`.
use super::*;
use unity_projet::{material_named, node_named, Projet};

/// Le GUID du modèle de chaque cas, et celui de la scène qui le cite.
const MODEL: &str = "0000000000000000000000000000000a";

/// Un objet qui instancie le modèle entier, transformation neutre.
fn instancie(name: &str, mesh: &str) -> String {
    format!(
        "--- !u!1 &100\nGameObject:\n  serializedVersion: 6\n  m_Component:\n  - component: {{fileID: 101}}\n  - component: {{fileID: 102}}\n  - component: {{fileID: 103}}\n  m_Name: {name}\n  m_IsActive: 1\n--- !u!4 &101\nTransform:\n  m_GameObject: {{fileID: 100}}\n  m_LocalRotation: {{x: 0, y: 0, z: 0, w: 1}}\n  m_LocalPosition: {{x: 0, y: 0, z: 0}}\n  m_LocalScale: {{x: 1, y: 1, z: 1}}\n  m_Children: []\n  m_Father: {{fileID: 0}}\n--- !u!33 &102\nMeshFilter:\n  m_GameObject: {{fileID: 100}}\n  m_Mesh: {mesh}\n--- !u!23 &103\nMeshRenderer:\n  m_GameObject: {{fileID: 100}}\n  m_Enabled: 1\n  m_Materials: []\n"
    )
}

// Constat 31 : un `fileID` de soixante-quatre bits nomme un objet précis. Lu au travers d'un
// flottant, `2^53 + 1` retombe sur `2^53` : la table de noms du `.meta` ne rend plus rien et le
// modèle entier est instancié à la place du seul maillage demandé.
#[test]
fn a_meta_file_id_beyond_the_float_range_still_names_its_mesh() {
    let projet = Projet::new("fileid");
    projet.model(
        "Models/Paire.glb",
        MODEL,
        json!([{"name":"Fine","mesh":0},{"name":"Grosse","mesh":0}]),
        "  - first:\n      43: 9007199254740993\n    second: Fine\n",
    );
    projet.scene(&instancie(
        "Socle",
        &format!("{{fileID: 9007199254740993, guid: {MODEL}, type: 3}}"),
    ));
    let run = projet.compile("unity-fileid");
    let (manifest, gltf) = run.prepared("unity");
    assert_eq!(manifest["source"]["counts"]["subMeshes"], 1);
    assert!(
        node_named(&gltf, "Fine").is_some() && node_named(&gltf, "Grosse").is_none(),
        "seul le maillage que le fileID nomme est instancié"
    );
    assert_eq!(
        manifest["unsupported"]["unity-model-mesh-by-fileid"],
        Value::Null
    );
}

// Constat 32 : un matériau à la fois transparent et découpé reste fondu. La règle du mode alpha se
// lit sur les propriétés du matériau : transparent l'emporte, la découpe seule donne `MASK`.
#[test]
fn a_material_that_is_both_transparent_and_cut_out_stays_blended() {
    let projet = Projet::new("alpha");
    let melange = "000000000000000000000000000000b1";
    let decoupe = "000000000000000000000000000000c1";
    projet.data(
        "Materials/Melange.mat",
        melange,
        &mat(
            "Melange",
            "    - _Surface: 1\n    - _AlphaClip: 1\n    - _Cutoff: 0.25\n",
        ),
    );
    projet.data(
        "Materials/Decoupe.mat",
        decoupe,
        &mat("Decoupe", "    - _Mode: 1\n    - _Cutoff: 0.25\n"),
    );
    projet.scene(&format!(
        "{}{}",
        cube(100, "Fondu", melange),
        cube(200, "Masque", decoupe)
    ));
    let run = projet.compile("unity-alpha");
    let (manifest, gltf) = run.prepared("unity");
    let fondu = material_named(&gltf, "Melange");
    assert_eq!(
        fondu["alphaMode"], "BLEND",
        "transparent l'emporte sur la découpe"
    );
    assert_eq!(
        fondu["alphaCutoff"],
        Value::Null,
        "glTF ne découpe pas un matériau fondu"
    );
    let masque = material_named(&gltf, "Decoupe");
    assert_eq!(
        masque["alphaMode"], "MASK",
        "la découpe seule reste masquée"
    );
    assert_eq!(masque["alphaCutoff"], 0.25);
    assert_eq!(manifest["unsupported"]["unity-material-clip-and-blend"], 1);
}

/// Un `.mat` dont les flottants sont ceux du cas.
fn mat(name: &str, floats: &str) -> String {
    format!(
        "--- !u!21 &2100000\nMaterial:\n  serializedVersion: 8\n  m_Name: {name}\n  m_SavedProperties:\n    serializedVersion: 3\n    m_TexEnvs: []\n    m_Floats:\n{floats}    m_Colors:\n    - _BaseColor: {{r: 1, g: 1, b: 1, a: 1}}\n"
    )
}

/// Un cube intégré de l'éditeur, portant le matériau de ce GUID.
fn cube(id: u32, name: &str, guid: &str) -> String {
    format!(
        "--- !u!1 &{id}\nGameObject:\n  serializedVersion: 6\n  m_Component:\n  - component: {{fileID: {}}}\n  - component: {{fileID: {}}}\n  - component: {{fileID: {}}}\n  m_Name: {name}\n  m_IsActive: 1\n--- !u!4 &{}\nTransform:\n  m_GameObject: {{fileID: {id}}}\n  m_LocalRotation: {{x: 0, y: 0, z: 0, w: 1}}\n  m_LocalPosition: {{x: 0, y: 0, z: 0}}\n  m_LocalScale: {{x: 1, y: 1, z: 1}}\n  m_Children: []\n  m_Father: {{fileID: 0}}\n--- !u!33 &{}\nMeshFilter:\n  m_GameObject: {{fileID: {id}}}\n  m_Mesh: {{fileID: 10202, guid: 0000000000000000e000000000000000, type: 0}}\n--- !u!23 &{}\nMeshRenderer:\n  m_GameObject: {{fileID: {id}}}\n  m_Enabled: 1\n  m_Materials:\n  - {{fileID: 2100000, guid: {guid}, type: 2}}\n",
        id + 1,
        id + 2,
        id + 3,
        id + 1,
        id + 2,
        id + 3
    )
}
