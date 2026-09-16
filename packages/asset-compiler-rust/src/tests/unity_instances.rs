//! Ce qu'une instance de prefab pose, retire et remplace, et ce qu'un maillage partagé garde de
//! propre à chaque instance. Les propriétés de matériau et de texture sont dans `unity_proprietes.rs`.
use super::*;
use unity_projet::{cube, material_index, materiau, node_named, objet, Projet, BUILTIN};

/// Les GUID des fichiers de chaque cas.
const MAT: &str = "000000000000000000000000000000a1";
const SOURCE: &str = "000000000000000000000000000000a2";
const OUTER: &str = "000000000000000000000000000000a3";

/// Le GUID du modèle de chaque cas.
const MODEL: &str = "0000000000000000000000000000000a";

/// Un `.mat` uni, le plus court que le pilote lise.
fn matiere(name: &str) -> String {
    unity_projet::mat_blanc(name, "    - _Metallic: 0\n")
}

/// Une instance de prefab racine, sur la source de ce GUID, avec les retouches du cas.
fn instance(id: u32, guid: &str, body: &str) -> String {
    format!(
        "--- !u!1001 &{id}\nPrefabInstance:\n  serializedVersion: 2\n  m_Modification:\n    m_TransformParent: {{fileID: 0}}\n{body}  m_SourcePrefab: {{fileID: 100100000, guid: {guid}, type: 3}}\n"
    )
}

/// Une retouche qui vise cet objet de la source.
fn retouche(target: u32, guid: &str, path: &str, value: &str) -> String {
    format!("    - target: {{fileID: {target}, guid: {guid}, type: 3}}\n      propertyPath: {path}\n      value: {value}\n      objectReference: {{fileID: 0}}\n")
}

// Constat 47 : un prefab instancié dans un prefab garde ses propres retouches, et l'instance
// extérieure pose les siennes par-dessus, dans l'ordre de nidification. Sans cela, tout ce que
// l'auteur a changé depuis la scène sur un objet du prefab imbriqué est perdu.
#[test]
fn the_outer_overrides_of_a_nested_prefab_reach_its_objects() {
    let projet = Projet::new("prefab-imbrique");
    projet.data("Materials/Uni.mat", MAT, &matiere("Uni"));
    projet.data("Prefabs/Inner.prefab", SOURCE, &cube(100, "Boite", MAT));
    projet.data(
        "Prefabs/Outer.prefab",
        OUTER,
        &instance(
            900,
            SOURCE,
            &format!(
                "    m_Modifications:\n{}",
                retouche(101, SOURCE, "m_LocalPosition.x", "1")
            ),
        ),
    );
    projet.scene(&instance(
        5000,
        OUTER,
        &format!(
            "    m_Modifications:\n{}",
            retouche(101, OUTER, "m_LocalPosition.x", "5")
        ),
    ));
    let (_, gltf) = projet.compile("unity-prefab-imbrique").prepared("unity");
    assert_eq!(
        node_named(&gltf, "Boite").expect("l'objet du prefab imbriqué")["translation"],
        json!([5.0, 0.0, 0.0]),
        "la retouche extérieure l'emporte sur celle du prefab imbriqué"
    );
}

// Constat 47 : une instance ne fait pas que replacer sa source. Elle en retire des composants, elle
// lui ajoute des objets, et elle lui ajoute des composants. Un rendu retiré n'émet rien, un objet
// ajouté sort sous l'objet qu'il vise, et ce qui reste hors de portée est compté par son nom.
#[test]
fn a_prefab_instance_removes_and_adds_objects_of_its_source() {
    let projet = Projet::new("prefab-retire");
    projet.data("Materials/Uni.mat", MAT, &matiere("Uni"));
    projet.data(
        "Prefabs/Source.prefab",
        SOURCE,
        &format!("{}{}", cube(100, "Gardee", MAT), cube(200, "Retiree", MAT)),
    );
    projet.scene(&format!(
        "{}{}",
        instance(
            5000,
            SOURCE,
            &"    m_Modifications: []\n    m_RemovedComponents:\n    - {fileID: 203, guid: 000000000000000000000000000000a2, type: 3}\n    m_AddedGameObjects:\n    - targetCorrespondingSourceObject: {fileID: 101, guid: 000000000000000000000000000000a2, type: 3}\n      insertionIndex: -1\n      addedObject: {fileID: 701}\n    m_AddedComponents:\n    - targetCorrespondingSourceObject: {fileID: 100, guid: 000000000000000000000000000000a2, type: 3}\n      addedObject: {fileID: 801}\n".to_string()
        ),
        objet(700, "Ajoutee", BUILTIN, &materiau(MAT), 5001)
    ));
    let (manifest, gltf) = projet.compile("unity-prefab-retire").prepared("unity");
    assert!(
        node_named(&gltf, "Retiree").expect("l'objet reste")["mesh"].is_null(),
        "un rendu retiré par l'instance n'émet aucun maillage"
    );
    let gardee = node_named(&gltf, "Gardee").expect("l'objet gardé");
    let ajoutee = node_named(&gltf, "Ajoutee").expect("l'objet ajouté");
    assert!(
        gardee["children"]
            .as_array()
            .is_some_and(|children| children.contains(
                &gltf["nodes"]
                    .as_array()
                    .expect("nodes")
                    .iter()
                    .position(|node| node == ajoutee)
                    .map(|rank| json!(rank))
                    .expect("le rang de l'objet ajouté")
            )),
        "l'objet ajouté sort sous l'objet que l'instance vise"
    );
    assert_eq!(
        manifest["unsupported"]["unity-prefab-added-component-unconverted"],
        json!(1),
        "le composant ajouté est compté par son nom: {}",
        manifest["unsupported"]
    );
}

// Constat 48 : un emplacement de matériau qu'une instance vide sort sans matériau. Garder celui du
// prefab rendrait visible ce que l'auteur avait effacé ; un emplacement que l'instance ne nomme pas,
// lui, garde bien celui du prefab.
#[test]
fn a_null_material_override_leaves_its_slot_without_a_material() {
    let projet = Projet::new("materiau-nul");
    projet.data("Materials/Uni.mat", MAT, &matiere("Uni"));
    projet.data("Prefabs/Source.prefab", SOURCE, &cube(100, "Boite", MAT));
    projet.scene(&instance(
        5000,
        SOURCE,
        "    m_Modifications:\n    - target: {fileID: 103, guid: 000000000000000000000000000000a2, type: 3}\n      propertyPath: m_Materials.Array.data[0]\n      value: \n      objectReference: {fileID: 0}\n",
    ));
    let (_, gltf) = projet.compile("unity-materiau-nul").prepared("unity");
    let mesh = node_named(&gltf, "Boite").expect("l'objet")["mesh"]
        .as_u64()
        .expect("son maillage") as usize;
    assert_eq!(
        gltf["meshes"][mesh]["primitives"][0]["material"],
        Value::Null,
        "l'emplacement vidé sort sans matériau"
    );
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

/// Le matériau que porte le maillage du premier enfant de ce nœud.
fn material_of_child(gltf: &Value, name: &str) -> Value {
    let node = node_named(gltf, name).unwrap_or_else(|| panic!("le nœud {name}"));
    let child = node["children"][0].as_u64().expect("un enfant") as usize;
    let mesh = gltf["nodes"][child]["mesh"].as_u64().expect("un maillage") as usize;
    gltf["meshes"][mesh]["primitives"][0]["material"].clone()
}
