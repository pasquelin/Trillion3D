//! Ce qu'un maillage de modèle garde de propre à chaque instance qui le cite, et ce qu'un
//! `LODGroup` écarte. Les retouches d'instance sont dans `unity_instances.rs`.
use super::*;
use unity_projet::{
    enfants, mat_blanc, material_index, materiau, node_named, objet, Projet, BUILTIN,
};

/// Les GUID des fichiers de chaque cas.
const MAT: &str = "000000000000000000000000000000a1";
const MODEL: &str = "0000000000000000000000000000000a";

/// Un `.mat` uni, le plus court que le pilote lise.
fn matiere(name: &str) -> String {
    mat_blanc(name, "    - _Metallic: 0\n")
}

// Constat 49 : deux rendus qui désignent le même maillage de modèle ne portent pas les mêmes
// matériaux. Le maillage versé est partagé ; chaque liaison différente en reçoit sa variante, et
// celui qu'une instance a déjà posé sans liaison n'est jamais réécrit sous elle.
#[test]
fn two_renderers_that_share_a_mesh_keep_their_own_materials() {
    let projet = Projet::new("maillage-partage");
    let (rouge, verte) = (
        "000000000000000000000000000000b1",
        "000000000000000000000000000000b2",
    );
    projet.data("Materials/Rouge.mat", rouge, &matiere("Rouge"));
    projet.data("Materials/Verte.mat", verte, &matiere("Verte"));
    projet.model(
        "Models/Piece.glb",
        MODEL,
        json!([{"name":"Piece","mesh":0}]),
        "",
    );
    let mesh = format!("{{fileID: 4300000, guid: {MODEL}, type: 3}}");
    projet.scene(&format!(
        "{}{}{}",
        objet(100, "Nue", &mesh, "[]", 0),
        objet(200, "Rouge", &mesh, &materiau(rouge), 0),
        objet(300, "Verte", &mesh, &materiau(verte), 0)
    ));
    let (_, gltf) = projet.compile("unity-maillage-partage").prepared("unity");
    assert_eq!(
        material_of_child(&gltf, "Nue"),
        Value::Null,
        "le rendu qui ne déclare aucun matériau garde le maillage du modèle tel quel"
    );
    assert_eq!(
        material_of_child(&gltf, "Rouge"),
        material_index(&gltf, "Rouge")
    );
    assert_eq!(
        material_of_child(&gltf, "Verte"),
        material_index(&gltf, "Verte")
    );
}

// Constat 50 : un rendu que plusieurs niveaux d'un `LODGroup` citent est gardé au niveau le plus
// détaillé où il apparaît. L'écarter parce qu'un niveau grossier le cite aussi retire du LOD0 une
// surface que la scène y montre.
#[test]
fn a_renderer_listed_in_two_lod_levels_is_kept_at_the_finest_one() {
    let projet = Projet::new("lod-partage");
    projet.data("Materials/Uni.mat", MAT, &matiere("Uni"));
    let group = "--- !u!1 &400\nGameObject:\n  serializedVersion: 6\n  m_Component:\n  - component: {fileID: 401}\n  - component: {fileID: 402}\n  m_Name: Groupe\n  m_IsActive: 1\n--- !u!205 &402\nLODGroup:\n  m_GameObject: {fileID: 400}\n  m_LODs:\n  - renderers:\n    - renderer: {fileID: 103}\n    - renderer: {fileID: 203}\n  - renderers:\n    - renderer: {fileID: 203}\n";
    projet.scene(&format!(
        "{group}{}{}{}",
        enfants(401, 400, 0, "\n  - {fileID: 101}\n  - {fileID: 201}"),
        objet(100, "Fine", BUILTIN, &materiau(MAT), 401),
        objet(200, "Partagee", BUILTIN, &materiau(MAT), 401)
    ));
    let (manifest, gltf) = projet.compile("unity-lod-partage").prepared("unity");
    for name in ["Fine", "Partagee"] {
        assert!(
            !node_named(&gltf, name).expect("l'objet du niveau")["mesh"].is_null(),
            "{name} est cité par le niveau le plus fin: son maillage est gardé"
        );
    }
    assert_eq!(
        manifest["source"]["counts"]["lodDropped"],
        Value::Null,
        "aucun rendu n'est écarté"
    );
}

/// Le matériau que porte le maillage du premier enfant de ce nœud.
fn material_of_child(gltf: &Value, name: &str) -> Value {
    let node = node_named(gltf, name).unwrap_or_else(|| panic!("le nœud {name}"));
    let child = node["children"][0].as_u64().expect("un enfant") as usize;
    let mesh = gltf["nodes"][child]["mesh"].as_u64().expect("un maillage") as usize;
    gltf["meshes"][mesh]["primitives"][0]["material"].clone()
}
