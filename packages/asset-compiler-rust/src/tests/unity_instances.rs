//! Ce qu'une instance de prefab pose, retire et remplace, et ce qu'un maillage partagé garde de
//! propre à chaque instance. Les propriétés de matériau et de texture sont dans `unity_proprietes.rs`.
use super::*;
use unity_projet::{cube, node_named, Projet};

/// Les GUID des fichiers de chaque cas.
const MAT: &str = "000000000000000000000000000000a1";
const SOURCE: &str = "000000000000000000000000000000a2";
const OUTER: &str = "000000000000000000000000000000a3";

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
